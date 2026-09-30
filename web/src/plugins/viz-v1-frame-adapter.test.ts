import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device, Flow, StateMsg } from "../core/types";
import { monoMs } from "../core/viz-time";
import { mockPartial } from "../../test-support/mock-partial";
import type { VizDataFrame } from "./viz-host";
import {
  VizV1FrameAdapter,
  convertVizFrameV2ToV1,
  defaultV1WorkBudget,
} from "./viz-v1-frame-adapter";
import { buildVizFrameForV1AdapterDelivery } from "./viz-host";

beforeEach(() => expect.hasAssertions());

function sampleV2(t: number, talkerCount = 6): VizDataFrame {
  const talkers = Array.from({ length: talkerCount }, (_, i) => ({
    id: `10.0.0.${i + 1}`,
    rate: 100 + i,
    role: "lan",
    failed: 0.1,
  }));
  return {
    contract: 2,
    t,
    dt: 0.016,
    audio: 0.2,
    packets: [{ proto: "tcp", size: 100, field: 0.5 }],
    rf: [{ ssid: "demo", rssi: 0.4, channel: 6 }],
    talkers,
    links: [{ src: "10.0.0.1", dst: "10.0.0.2", rate: 12 }],
    headlines: [{ id: "h1", label: "HN", text: "headline" }],
    sys: { cpu: 0.1, mem: 0.2, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0.5, udev: 0 },
  };
}

describe("VizV1FrameAdapter", () => {
  it("does nothing when no v1 pack is loaded", () => {
    const adapter = new VizV1FrameAdapter();
    expect(adapter.frameFor("missing")).toBeUndefined();
    adapter.deliver(sampleV2(1));
    expect(adapter.frameFor("missing")).toBeUndefined();
  });

  it("runs v2→v1 conversion once per frame for two v1 packs over 300 frames", () => {
    const adapter = new VizV1FrameAdapter();
    const a = adapter.register("pack-a", defaultV1WorkBudget({ maxTalkers: 8 }));
    adapter.register("pack-b", defaultV1WorkBudget({ maxTalkers: 8 }));
    for (let i = 0; i < 300; i++) adapter.deliver(sampleV2(i));
    expect(a.t).toBe(299);
  });

  it("gives each pack the same frame instance every deliver and different instances across packs", () => {
    const adapter = new VizV1FrameAdapter();
    const a = adapter.register("pack-a");
    const b = adapter.register("pack-b");
    expect(a).not.toBe(b);
    for (let i = 0; i < 300; i++) {
      adapter.deliver(sampleV2(i));
      expect(adapter.frameFor("pack-a")).toBe(a);
      expect(adapter.frameFor("pack-b")).toBe(b);
    }
  });

  it("isolates talker writes between packs", () => {
    const adapter = new VizV1FrameAdapter();
    const a = adapter.register("pack-a");
    const b = adapter.register("pack-b");
    adapter.deliver(sampleV2(1));
    a.talkers[0]!.rate = -1;
    expect(b.talkers[0]!.rate).toBe(100);
    adapter.deliver(sampleV2(2));
    expect(a.talkers[0]!.rate).toBe(100);
  });

  it("keeps view options stable across delivers until syncViewOpts replaces them", () => {
    const adapter = new VizV1FrameAdapter();
    const opts = { source: "lan", layout: "grid" };
    const syncSpy = vi.spyOn(adapter, "syncViewOpts");
    const readViewOpts = (): Readonly<Record<string, string>> | null =>
      (adapter as unknown as { viewOpts: Readonly<Record<string, string>> | null }).viewOpts;
    adapter.syncViewOpts(opts);
    adapter.register("pack-a");
    for (let i = 0; i < 300; i++) adapter.deliver(sampleV2(i));
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(readViewOpts()?.source).toBe("lan");
    opts.source = "mutated";
    expect(readViewOpts()?.source).toBe("lan");
    adapter.syncViewOpts({ source: "wan", layout: "list" });
    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(readViewOpts()?.source).toBe("wan");
  });

  it("maps lifetime talker counts through the host v1 delivery build and adapter", () => {
    // Devices carry no byte counter (the host reads `packets`); flows keep theirs.
    const state = mockPartial<StateMsg>({
      ts: 100,
      devices: [
        mockPartial<Device>({ ip: "192.168.1.3", packets: 209, role: "lan" }),
        mockPartial<Device>({ ip: "192.168.1.1", packets: 208, role: "lan" }),
        mockPartial<Device>({ ip: "192.168.1.2", packets: 50, role: "lan" }),
      ],
      flows: [
        mockPartial<Flow>({ a: "192.168.1.3", b: "192.168.1.1", packets: 100, bytes: 1000, rate_pkt_ab: 273, rate_pkt_ba: 0 }),
        mockPartial<Flow>({ a: "192.168.1.2", b: "192.168.1.1", packets: 50, bytes: 500, rate_pkt_ab: 202.8, rate_pkt_ba: 0 }),
      ],
      sources: {},
    });
    const hostFrame = buildVizFrameForV1AdapterDelivery(state, monoMs(0), 0, { fixture: "host" });
    const adapter = new VizV1FrameAdapter();
    const packFrame = adapter.register("probe");
    adapter.deliver(hostFrame);
    expect(packFrame.talkers[0]?.id).toBe("192.168.1.3");
    expect(packFrame.talkers[0]?.rate).toBe(209);
    expect(packFrame.talkers[1]?.rate).toBe(208);
    expect(packFrame.talkers[2]?.rate).toBe(50);
  });

  it("restores full talker list after a pack splices talkers out", () => {
    const adapter = new VizV1FrameAdapter();
    const a = adapter.register("pack-a", defaultV1WorkBudget({ maxTalkers: 8 }));
    adapter.register("pack-b");
    adapter.deliver(sampleV2(1, 6));
    expect(a.talkers.length).toBe(6);
    expect(a.talkers[0]).toBeDefined();
    const firstInst = a.talkers[0];
    const beforeLen = a.talkers.length;
    a.talkers.splice(0, 2);
    expect(a.talkers.length).toBe(beforeLen - 2);
    adapter.deliver(sampleV2(2, 6));
    expect(a.talkers.length).toBe(beforeLen);
    expect(a.talkers[0]).toBe(firstInst);
    expect(a.talkers[0]!.rate).toBe(100);
  });
});

describe("convertVizFrameV2ToV1", () => {
  it("strips v2-only talker failed and links from the work frame", () => {
    const dest: VizDataFrame = {
      contract: 1,
      t: 0,
      dt: 0,
      audio: 0,
      packets: [],
      rf: [],
      talkers: [],
      headlines: [],
    };
    const workTalkers = [{ id: "", rate: 0, role: "" }];
    convertVizFrameV2ToV1(sampleV2(1, 1), dest, workTalkers, 8);
    expect(dest.contract).toBe(1);
    expect(dest.links).toBeUndefined();
    expect(dest.talkers[0]?.failed).toBeUndefined();
  });
});
