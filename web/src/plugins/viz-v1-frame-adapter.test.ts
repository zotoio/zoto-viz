import { describe, expect, it } from "vitest";
import type { VizDataFrame } from "./viz-host";
import {
  VizV1FrameAdapter,
  convertVizFrameV2ToV1,
  defaultV1WorkBudget,
} from "./viz-v1-frame-adapter";

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
    adapter.deliver(sampleV2(1));
    expect(adapter.convertCalls).toBe(0);
  });

  it("runs v2→v1 conversion once per frame for two v1 packs over 300 frames", () => {
    const adapter = new VizV1FrameAdapter();
    adapter.register("pack-a", defaultV1WorkBudget({ maxTalkers: 8 }));
    adapter.register("pack-b", defaultV1WorkBudget({ maxTalkers: 8 }));
    adapter.resetConvertCallsForTest();
    for (let i = 0; i < 300; i++) adapter.deliver(sampleV2(i));
    expect(adapter.convertCalls).toBe(300);
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

  it("restores full talker list after a pack splices talkers out", () => {
    const adapter = new VizV1FrameAdapter();
    const a = adapter.register("pack-a", defaultV1WorkBudget({ maxTalkers: 8 }));
    adapter.register("pack-b");
    adapter.deliver(sampleV2(1, 6));
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
