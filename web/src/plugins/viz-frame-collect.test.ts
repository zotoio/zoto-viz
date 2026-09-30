import { beforeEach, describe, expect, it } from "vitest";
import type { Flow, StateMsg } from "../core/types";
import { monoMs } from "../core/viz-time";
import type { HostSandboxPortMsg } from "./sandbox-channel";
import type { VizDataFrame } from "./viz-host";
import { buildVizFrame, buildVizFrameForPlugin, VIZ_CONTRACT_VERSION } from "./viz-host";
import { buildIdleVizFrame, buildIdleVizFrameFailed } from "./fixtures/idle-viz-frame";
import {
  buildVizSdkVmLiveFrame,
  vmLiveCaptureState,
  VIZ_SDK_HOST_IDLE,
} from "./fixtures/viz-sdk-frame-build";
import { assertLinksMatchTalkers } from "./fixtures/viz-frame-collect-assert";
import {
  collectVizLinks,
  connFailRatio,
} from "./viz-frame-collect";
import { EMPTY_VIZ_LINKS } from "../../../plugins/sdk/viz-contract";

const DEMO_LAN_IP = "10.0.0.42";

beforeEach(() => {
  expect.hasAssertions();
});

describe("viz frame v2 collector", () => {
  it("aggregates duplicate directional pairs and ignores self-links", () => {
    const flows: Flow[] = [
      {
        a: "10.0.0.1", b: "10.0.0.2", bytes: 1000, packets: 100, ports: [], protos: ["tcp"],
        ifaces: [], first_seen: 0, last_seen: 1, rate: 1, rate_pkt_ab: 5, rate_pkt_ba: 0,
      },
      {
        a: "10.0.0.1", b: "10.0.0.2", bytes: 500, packets: 50, ports: [], protos: ["tcp"],
        ifaces: [], first_seen: 0, last_seen: 1, rate: 1, rate_pkt_ab: 7, rate_pkt_ba: 0,
      },
      {
        a: "10.0.0.1", b: "10.0.0.1", bytes: 100, packets: 10, ports: [], protos: ["tcp"],
        ifaces: [], first_seen: 0, last_seen: 1, rate: 1, rate_pkt_ab: 99, rate_pkt_ba: 0,
      },
    ];
    const talkers = new Set(["10.0.0.1", "10.0.0.2"]);
    const { links } = collectVizLinks(flows, talkers, 64);
    expect(links).toEqual([{ src: "10.0.0.1", dst: "10.0.0.2", rate: 12 }]);
  });

  it("aggregates directional pair rates and drops links whose ids are not talkers", () => {
    const flows: Flow[] = [
      {
        a: "10.0.0.1", b: "10.0.0.2", bytes: 1000, packets: 100, ports: [], protos: ["tcp"],
        ifaces: [], first_seen: 0, last_seen: 1, rate: 1, rate_pkt_ab: 12, rate_pkt_ba: 3,
      },
      {
        a: "10.0.0.1", b: "8.8.8.8", bytes: 500, packets: 50, ports: [], protos: ["udp"],
        ifaces: [], first_seen: 0, last_seen: 1, rate: 1, rate_pkt_ab: 20, rate_pkt_ba: 0,
      },
    ];
    const talkers = new Set(["10.0.0.1", "10.0.0.2", "8.8.8.8"]);
    const { links } = collectVizLinks(flows, talkers, 64);
    expect(links).toEqual([
      { src: "10.0.0.1", dst: "8.8.8.8", rate: 20 },
      { src: "10.0.0.1", dst: "10.0.0.2", rate: 12 },
      { src: "10.0.0.2", dst: "10.0.0.1", rate: 3 },
    ]);
  });

  it("caps links and reports dropped count on unique pairs", () => {
    const flows: Flow[] = Array.from({ length: 80 }, (_, i) => ({
      a: "10.0.0.1",
      b: `10.0.0.${i + 2}`,
      bytes: 10,
      packets: 10,
      ports: [],
      protos: ["tcp"],
      ifaces: [],
      first_seen: 0,
      last_seen: 1,
      rate: 1,
      rate_pkt_ab: i + 1,
      rate_pkt_ba: 0,
    }));
    const talkers = new Set(["10.0.0.1", ...flows.map((f) => f.b)]);
    const { links, linksDropped } = collectVizLinks(flows, talkers, 8);
    expect(links).toHaveLength(8);
    expect(linksDropped).toBe(72);
    expect(links[0]?.rate).toBe(80);
  });

  it("stamps empty links as the shared EMPTY_VIZ_LINKS constant when collection is on but no pairs qualify", () => {
    const state = syntheticState({ host: { vizFrame: { links: true } }, flows: [] });
    const frame = buildVizFrame(state, monoMs(0), 0);
    expect(frame.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(frame.links).toEqual([]);
    expect(frame.links).toBe(EMPTY_VIZ_LINKS);
  });

  it("omits link enrichment when the monitor switch is off but stamps contract", () => {
    const state = syntheticState({ host: { vizFrame: { links: false } } });
    const frame = buildVizFrame(state, monoMs(0), 0);
    expect(frame.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(frame.links).toBeUndefined();
    expect(frame.talkers.every((t) => t.failed === undefined)).toBe(true);
  });

  it("computes per-host failure as a ratio", () => {
    expect(connFailRatio(2, 10)).toBeCloseTo(0.2);
    expect(connFailRatio(0, 10)).toBe(0);
    expect(connFailRatio(3, 0)).toBe(0);
  });
});

describe("idle demo v2", () => {
  it("default idle is healthy and deterministic with distinct talker arrays", () => {
    const a = buildIdleVizFrame(85, 0.016);
    const b = buildIdleVizFrame(85, 0.016);
    expect(a).toEqual(b);
    expect(a.talkers).not.toBe(b.talkers);
    expect(a.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(a.links?.length).toBeGreaterThan(0);
    expect(a.sys?.failed).toBe(0);
    expect(a.talkers.every((t) => t.failed === undefined)).toBe(true);
  });

  it("nested quiet frames do not alias talker arrays", () => {
    const state = vmLiveCaptureState();
    const first = buildVizFrameForPlugin(state, monoMs(0), 0, VIZ_SDK_HOST_IDLE, 2);
    const second = buildVizFrameForPlugin(state, monoMs(first.t), 0, VIZ_SDK_HOST_IDLE, 2);
    expect(first.talkers).not.toBe(second.talkers);
    expect(first.talkers).toEqual(second.talkers);
  });

  it("failure demo fixture is deterministic across ticks", () => {
    const a = buildIdleVizFrameFailed(85, 0.016);
    const b = buildIdleVizFrameFailed(999, 0.5);
    expect(a.talkers).toEqual(b.talkers);
    expect(a.sys).toEqual(b.sys);
    expect(a.talkers.some((t) => t.failed !== undefined)).toBe(true);
  });
});

describe("vm-live quiet capture", () => {
  it("enrichment keeps links within talker ids and does not invent failed or demo endpoints", () => {
    const state = vmLiveCaptureState();
    expect(state.devices.length).toBeGreaterThan(0);
    expect(state.flows).toHaveLength(0);
    const frame = buildVizFrameForPlugin(state, monoMs(0), 0, VIZ_SDK_HOST_IDLE, 2);
    expect(frame.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(frame.links ?? []).toHaveLength(0);
    expect(frame.talkers.every((t) => t.failed === undefined)).toBe(true);
    assertLinksMatchTalkers(frame);
    for (const link of frame.links ?? []) {
      expect(link.src).not.toBe(DEMO_LAN_IP);
      expect(link.dst).not.toBe(DEMO_LAN_IP);
    }
    const frozen = buildVizSdkVmLiveFrame();
    expect(frozen.links ?? []).toHaveLength(0);
    expect(frozen.talkers.every((t) => t.failed === undefined)).toBe(true);
  });
});

/** The host's frame message on the sandbox port; the port type itself carries `frame: unknown`. */
type FrameMsg = Extract<HostSandboxPortMsg, { type: "frame" }> & { frame: VizDataFrame };

describe("host serialisation", () => {
  it("round-trips v2 fields through JSON like postMessage", () => {
    const frame: VizDataFrame = {
      ...buildIdleVizFrameFailed(1, 0),
      talkers: [{ id: "10.0.0.42", rate: 1, role: "lan", failed: 0.5 }],
    };
    const msg: FrameMsg = { source: "zoto-viz-host", type: "frame", frame };
    const parsed: FrameMsg = JSON.parse(JSON.stringify(msg));
    expect(parsed.type).toBe("frame");
    if (parsed.type !== "frame") return;
    expect(parsed.frame.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(parsed.frame.talkers[0]?.failed).toBeCloseTo(0.5);
  });
});

describe("buildVizFrame v2", () => {
  it("adds per-talker failed from device conn_fail ratio gauges", () => {
    const frame = buildVizFrame(syntheticState(), monoMs(0), 0);
    expect(frame.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(frame.talkers.find((t) => t.id === "10.0.0.2")?.failed).toBeCloseTo(0.5);
  });

  it("does not merge demo link IPs when live talkers are present without flows", () => {
    const state: StateMsg = {
      ...syntheticState(),
      flows: [],
      devices: [
        {
          ip: "192.168.1.3", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
          ifaces: [], aliases: [], first_seen: 0, last_seen: 1, role: "lan", online: true,
          packets: 50, bytes_in: 1, bytes_out: 1,
        },
        {
          ip: "192.168.1.1", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
          ifaces: [], aliases: [], first_seen: 0, last_seen: 1, role: "gateway", online: true,
          packets: 10, bytes_in: 1, bytes_out: 1,
        },
      ],
    };
    const frame = buildVizFrameForPlugin(state, monoMs(0), 0, { fixture: "host" });
    expect(frame.links ?? []).toHaveLength(0);
    assertLinksMatchTalkers(frame);
    for (const link of frame.links ?? []) {
      expect(link.src).not.toBe(DEMO_LAN_IP);
      expect(link.dst).not.toBe(DEMO_LAN_IP);
    }
  });
});

function syntheticState(overrides: Partial<StateMsg> = {}): StateMsg {
  return {
    type: "state",
    ts: 10,
    iface: "eth0",
    interfaces: [],
    network: "10.0.0.0/24",
    local_ip: "10.0.0.1",
    gateway: "10.0.0.1",
    uptime: 1,
    stats: {
      pps: 1, bps: 1, devices: 3, online: 3, flows: 2, active_flows: 2, packets: 10, bytes: 100,
    },
    devices: [
      {
        ip: "10.0.0.1", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
        ifaces: [], aliases: [], first_seen: 0, last_seen: 1, role: "gateway", online: true,
        packets: 10, bytes_in: 1, bytes_out: 1,
      },
      {
        ip: "10.0.0.2", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
        ifaces: [], aliases: [], first_seen: 0, last_seen: 1, role: "lan", online: true,
        packets: 5, bytes_in: 1, bytes_out: 1, conn_fail: 0.5,
      },
      {
        ip: "8.8.8.8", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
        ifaces: [], aliases: [], first_seen: 0, last_seen: 1, role: "internet", online: true,
        packets: 4, bytes_in: 1, bytes_out: 1,
      },
    ],
    flows: [
      {
        a: "10.0.0.1", b: "10.0.0.2", bytes: 100, packets: 10, ports: [], protos: ["tcp"],
        ifaces: [], first_seen: 0, last_seen: 1, rate: 1, rate_pkt_ab: 5, rate_pkt_ba: 1,
      },
    ],
    host: { vizFrame: { links: true, linksMax: 64 } },
    ...overrides,
  };
}
