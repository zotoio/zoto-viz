import { monoMs } from "../../core/viz-time";
import { describe, expect, it } from "vitest";
import type { StateMsg } from "../../core/types";
import { buildIdleVizFrame, IDLE_VIZ_DEMO_HOSTS } from "./idle-viz-frame";
import { goldenLanFixture } from "./golden-lan-state";
import {
  buildVizFrame,
  buildVizFrameForPlugin,
  mergeVizIdleFrame,
  parseVizIdle,
} from "../viz-host";

describe("buildIdleVizFrame", () => {
  it("returns non-empty demo slices", () => {
    const frame = buildIdleVizFrame(12.5, 0.016);
    expect(frame.packets.length).toBeGreaterThan(0);
    expect(frame.rf.length).toBeGreaterThan(0);
    expect(frame.talkers.length).toBeGreaterThan(0);
    expect(frame.headlines.length).toBeGreaterThan(0);
    expect(frame.audio).toBeGreaterThan(0);
    expect(frame.t).toBe(12.5);
  });
});

describe("IDLE_VIZ_DEMO_HOSTS (#181 arcade idle feed)", () => {
  it("is the idle frame's talkers, with their link peers, read-only", () => {
    const frame = buildIdleVizFrame(1, 0);
    expect(IDLE_VIZ_DEMO_HOSTS.map((h) => [h.ip, h.role])).toEqual(frame.talkers.map((t) => [t.id, t.role]));
    for (const h of IDLE_VIZ_DEMO_HOSTS) {
      const peers = new Set(frame.links.flatMap((l) => (l.src === h.ip ? [l.dst] : l.dst === h.ip ? [l.src] : [])));
      expect(new Set(h.peers), h.ip).toEqual(peers);
      expect(h.opens, h.ip).toEqual(frame.links.filter((l) => l.src === h.ip).map((l) => l.dst));
    }
    expect(Object.isFrozen(IDLE_VIZ_DEMO_HOSTS) && IDLE_VIZ_DEMO_HOSTS.every((h) => Object.isFrozen(h))).toBe(true);
  });

  it("is a subset of the golden LAN state (golden-lan-state.ts): every ip, and its name where golden has one", () => {
    const golden = goldenLanFixture().devices;
    const off = IDLE_VIZ_DEMO_HOSTS.flatMap((h) => {
      const g = golden.find((d) => d.ip === h.ip);
      if (!g) return [`${h.ip} not in the golden LAN state`];
      const names = g.names.filter((n) => n !== g.ip);
      return names.length && !names.includes(h.name) ? [`${h.ip} "${h.name}" vs golden ${JSON.stringify(names)}`] : [];
    });
    expect(IDLE_VIZ_DEMO_HOSTS.length).toBeGreaterThan(0);
    expect(off).toEqual([]);
  });
});

describe("mergeVizIdleFrame", () => {
  const idle = { fixture: "host" as const };

  it("fills empty live slices from host fixture", () => {
    const live = {
      t: 5,
      dt: 0,
      audio: 0,
      packets: [],
      rf: [],
      talkers: [],
      headlines: [],
    };
    const merged = mergeVizIdleFrame(live, idle);
    expect(merged.packets.length).toBeGreaterThan(0);
    expect(merged.talkers.length).toBeGreaterThan(0);
    expect(merged.demo).toBe(true);
    expect(merged.demoSlices).toEqual({
      packets: true,
      rf: true,
      talkers: true,
      headlines: true,
    });
  });

  it("prefers live packets over idle", () => {
    const live = buildVizFrame(minimalState(), monoMs(0), 0);
    expect(live.packets.length).toBeGreaterThan(0);
    const merged = mergeVizIdleFrame(live, idle);
    expect(merged.packets[0]?.proto).toBe(live.packets[0]?.proto);
    expect(merged.packets[0]?.field).toBe(live.packets[0]?.field);
    expect(merged.demo).toBe(true);
  });

  it("leaves demo unset when every slice is live", () => {
    const live = {
      t: 5,
      dt: 0,
      audio: 0.1,
      packets: [{ proto: "tcp", size: 10, field: 0.5 }],
      rf: [{ ssid: "home", rssi: 0.5, channel: 6 }],
      talkers: [{ id: "10.0.0.1", rate: 50, role: "lan" }],
      headlines: [{ id: "h1", label: "HN", text: "Live" }],
    };
    const merged = mergeVizIdleFrame(live, idle);
    expect(merged).toBe(live);
    expect(merged.demo).toBeUndefined();
  });
});

describe("parseVizIdle", () => {
  it("accepts host fixture", () => {
    expect(parseVizIdle({ fixture: "host" })).toEqual({ fixture: "host" });
  });

  it("accepts inline seed", () => {
    const inline = parseVizIdle({
      packets: [{ proto: "icmp", size: 64, field: 0.2 }],
    });
    expect(inline).toEqual({
      inline: { packets: [{ proto: "icmp", size: 64, field: 0.2 }], rf: [], talkers: [], headlines: [] },
    });
  });
});

describe("buildVizFrameForPlugin", () => {
  it("yields non-zero packet-tunnel output on empty monitor state", () => {
    const empty: StateMsg = {
      type: "state",
      ts: 10,
      iface: "",
      interfaces: [],
      network: "",
      local_ip: "",
      gateway: "",
      uptime: 0,
      stats: {
        pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
      },
      devices: [],
      flows: [],
    };
    const frame = buildVizFrameForPlugin(empty, 0, 0, { fixture: "host" });
    expect(frame.packets.length).toBeGreaterThan(0);
    expect(frame.talkers.length).toBeGreaterThan(0);
  });
});

function minimalState(): StateMsg {
  return {
    type: "state",
    ts: 100,
    iface: "wlan0",
    interfaces: [],
    network: "192.168.1.0/24",
    local_ip: "192.168.1.2",
    gateway: "192.168.1.1",
    uptime: 10,
    stats: {
      pps: 10, bps: 1000, devices: 2, online: 2, flows: 1, active_flows: 1, packets: 100, bytes: 1000,
    },
    devices: [
      {
        ip: "192.168.1.3", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
        ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "lan", online: true,
        packets: 50, bytes_in: 1, bytes_out: 1,
      },
    ],
    flows: [
      {
        a: "192.168.1.3", b: "8.8.8.8", bytes: 100, packets: 80, ports: [], protos: ["tcp"],
        ifaces: [], first_seen: 0, last_seen: 0, rate: 1,
      },
    ],
  };
}
