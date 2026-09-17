import { afterEach, describe, expect, it, vi } from "vitest";
import type { Device, StateMsg } from "../core/types";
import {
  VIZ_DEFAULT_MAX_BUFFERS,
  VIZ_FRAME_BUDGET_MS,
  VIZ_MAX_TALKER_SAMPLES,
  VIZ_UBO,
  VizBufferWriter,
  VizFrameBudget,
  bindVizWriterCore,
  buildVizFrame,
  defaultVizContract,
  parseVizContract,
  pluginNeedsVizContract,
  topKByScore,
} from "./viz-host";

describe("viz contract", () => {
  it("requires graphWalk false in schema parse", () => {
    expect(parseVizContract({ graphWalk: false })).toBeDefined();
    expect(parseVizContract({ graphWalk: true })).toBeUndefined();
    expect(parseVizContract(undefined)).toBeUndefined();
  });

  it("clamps buffer and particle caps", () => {
    const c = parseVizContract({
      graphWalk: false,
      maxBuffers: 99,
      maxBufferFloats: 4,
      maxParticles: 99999,
    });
    expect(c?.maxBuffers).toBe(8);
    expect(c?.maxBufferFloats).toBe(4);
    expect(c?.maxParticles).toBe(8192);
  });

  it("attaches the fixed UBO layout", () => {
    const c = parseVizContract({ graphWalk: false });
    expect(c?.ubo).toEqual(VIZ_UBO);
    expect(c?.ubo.block).toBe("ZotoVizData");
    expect(c?.ubo.binding).toBe(0);
    expect(c?.ubo.totalBytes).toBe(2048);
  });

  it("detects viz capabilities separately from graph.read", () => {
    expect(pluginNeedsVizContract(["viz.read"])).toBe(true);
    expect(pluginNeedsVizContract(["graph.read"])).toBe(false);
    expect(pluginNeedsVizContract(["graph.read", "viz.write"])).toBe(true);
  });

  it("exposes the frame budget constant", () => {
    expect(VIZ_FRAME_BUDGET_MS).toBeCloseTo(16.7, 1);
    expect(defaultVizContract().maxBuffers).toBe(VIZ_DEFAULT_MAX_BUFFERS);
  });
});

describe("topKByScore", () => {
  it("never sorts arrays larger than the cap", () => {
    let maxSorted = 0;
    const orig = Array.prototype.sort;
    const sortSpy = vi.spyOn(Array.prototype, "sort").mockImplementation(function (
      this: unknown[],
      compareFn?: (a: unknown, b: unknown) => number,
    ) {
      if (Array.isArray(this)) maxSorted = Math.max(maxSorted, this.length);
      return orig.call(this, compareFn as (a: unknown, b: unknown) => number);
    });
    const items = Array.from({ length: 500 }, (_, i) => ({ n: i }));
    topKByScore(items, 24, (x) => x.n);
    expect(maxSorted).toBeLessThanOrEqual(24);
    sortSpy.mockRestore();
  });
});

describe("VizBufferWriter", () => {
  const contract = defaultVizContract({ maxBuffers: 2, maxBufferFloats: 8, maxParticles: 4 });

  it("rejects out-of-range buffer slots", () => {
    const w = new VizBufferWriter(contract);
    expect(w.writeBuffer(-1, [1]).ok).toBe(false);
    expect(w.writeBuffer(2, [1]).ok).toBe(false);
    expect(w.writeBuffer(0, [1, 2, 3]).ok).toBe(true);
  });

  it("rejects buffer writes over maxBufferFloats", () => {
    const w = new VizBufferWriter(contract);
    expect(w.writeBuffer(0, new Array(9).fill(0)).ok).toBe(false);
    expect(w.writeBuffer(0, new Array(8).fill(0)).ok).toBe(true);
  });

  it("reuses preallocated slot buffers (no per-write allocation)", () => {
    const w = new VizBufferWriter(contract);
    const backing = w.ubo;
    const slotView = w.snapshot(0);
    w.writeBuffer(0, [1, 2, 3]);
    expect(w.snapshot(0).buffer).toBe(backing.buffer);
    w.writeBuffer(0, [4, 5]);
    expect(backing[0]).toBe(4);
    expect(backing[1]).toBe(5);
    expect(slotView.buffer).toBe(backing.buffer);
  });

  it("enforces particle cap", () => {
    const w = new VizBufferWriter(contract);
    expect(w.writeParticles(new Array(20).fill(0), 4).ok).toBe(false);
    expect(w.writeParticles(new Array(16).fill(0), 4).ok).toBe(true);
    expect(w.writeParticles(new Array(4).fill(0), 4).written).toBe(1);
  });

  it("rejects particles when maxParticles is 0", () => {
    const w = new VizBufferWriter(defaultVizContract({ maxParticles: 0 }));
    expect(w.writeParticles([0, 0, 0, 0]).ok).toBe(false);
  });

  it("validates uniform contract", () => {
    const w = new VizBufferWriter(defaultVizContract({ uniforms: ["uBright", "uAccent"] }));
    expect(w.writeUniform("uMode", 1).ok).toBe(false);
    expect(w.writeUniform("uBright", 0.5).ok).toBe(true);
    expect(w.writeUniform("uAccent", [1, 0, 0]).ok).toBe(true);
    expect(w.writeUniform("uAccent", 1).ok).toBe(false);
  });
});

describe("bindVizWriterCore (demo pack-swap preserve path)", () => {
  const contract = defaultVizContract();

  function hostBindState(
    writer: VizBufferWriter | null,
    frameTs: number,
    budget: VizFrameBudget,
    preserveUbo: boolean,
  ): { writer: VizBufferWriter | null; frameTs: number; budget: VizFrameBudget } {
    const result = bindVizWriterCore(writer, contract, preserveUbo);
    return {
      writer: result.writer,
      frameTs: result.resetFrameTs ? 0 : frameTs,
      budget: result.resetBudget ? (budget.reset(), budget) : budget,
    };
  }

  it("preserves vizFrameTs, vizBudget skipped count, and UBO mirror bytes on preserveUbo rebind", () => {
    let writer = new VizBufferWriter(contract);
    writer.writeBuffer(0, [1, 2, 3, 4]);
    const uboBefore = writer.ubo.slice();

    let frameTs = 42.5;
    let ticks = 0;
    const budget = new VizFrameBudget(() => (++ticks === 1 ? 0 : VIZ_FRAME_BUDGET_MS + 1));
    budget.deliver(minimalState(), frameTs, 0, () => {});
    expect(budget.stats.skipped).toBe(1);

    const next = hostBindState(writer, frameTs, budget, true);
    writer = next.writer;
    frameTs = next.frameTs;

    expect(frameTs).toBe(42.5);
    expect(budget.stats.skipped).toBe(1);
    expect(writer).not.toBeNull();
    expect(Array.from(writer!.ubo)).toEqual(Array.from(uboBefore));
  });

  it("resets frame ts and budget on non-preserve rebind", () => {
    const writer = new VizBufferWriter(contract);
    writer.writeBuffer(0, [9, 8, 7]);

    let ticks = 0;
    const budget = new VizFrameBudget(() => (++ticks === 1 ? 0 : VIZ_FRAME_BUDGET_MS + 1));
    budget.deliver(minimalState(), 10, 0, () => {});
    expect(budget.stats.skipped).toBe(1);

    const next = hostBindState(writer, 10, budget, false);
    expect(next.frameTs).toBe(0);
    expect(next.budget.stats.skipped).toBe(0);
    expect(next.writer).not.toBe(writer);
    expect(next.writer!.ubo[0]).toBe(0);
  });

  it("falls back to reset when preserveUbo is set but no prior writer exists", () => {
    let ticks = 0;
    const budget = new VizFrameBudget(() => (++ticks === 1 ? 0 : VIZ_FRAME_BUDGET_MS + 1));
    budget.deliver(minimalState(), 5, 0, () => {});

    const next = hostBindState(null, 5, budget, true);
    expect(next.frameTs).toBe(0);
    expect(next.budget.stats.skipped).toBe(0);
    expect(next.writer).not.toBeNull();
  });
});

describe("VizFrameBudget", () => {
  it("counts over-budget frames and skips delivery", () => {
    const state = minimalState();
    const delivered: unknown[] = [];
    const onTime = new VizFrameBudget(() => 0);
    onTime.deliver(state, 0, 0, (f) => delivered.push(f));
    expect(delivered).toHaveLength(1);
    expect(onTime.stats.overBudget).toBe(0);
    expect(onTime.lastBuilt?.t).toBe(100);

    let n = 0;
    const slow = new VizFrameBudget(() => (++n === 1 ? 0 : VIZ_FRAME_BUDGET_MS + 1));
    const skipped = slow.deliver(state, 0, 0, (f) => delivered.push(f));
    expect(skipped).toBeNull();
    expect(slow.stats.overBudget).toBe(1);
    expect(slow.stats.skipped).toBe(1);
    expect(delivered).toHaveLength(1);
  });

  it("records duration via record()", () => {
    const budget = new VizFrameBudget();
    expect(budget.record(VIZ_FRAME_BUDGET_MS - 1)).toBe(false);
    expect(budget.record(VIZ_FRAME_BUDGET_MS + 0.1)).toBe(true);
    expect(budget.stats.overBudget).toBe(1);
  });

  it("counts present-to-present over-budget frames toward skipped", () => {
    const budget = new VizFrameBudget();
    budget.markPresent(0);
    expect(budget.stats.skipped).toBe(0);

    budget.markPresent(10);
    expect(budget.stats.skipped).toBe(0);
    expect(budget.stats.lastMs).toBeCloseTo(10, 5);

    budget.markPresent(10 + VIZ_FRAME_BUDGET_MS + 3);
    expect(budget.stats.skipped).toBe(1);
    expect(budget.stats.overBudget).toBe(1);
  });

  it("resets present baseline on reset()", () => {
    const budget = new VizFrameBudget();
    budget.markPresent(0);
    budget.markPresent(30);
    expect(budget.stats.skipped).toBe(1);
    budget.reset();
    budget.markPresent(100);
    expect(budget.stats.skipped).toBe(0);
  });
});

describe("buildVizFrame", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decimates state without sorting the full device list", () => {
    let maxSorted = 0;
    const orig = Array.prototype.sort;
    vi.spyOn(Array.prototype, "sort").mockImplementation(function (
      this: unknown[],
      compareFn?: (a: unknown, b: unknown) => number,
    ) {
      if (Array.isArray(this)) maxSorted = Math.max(maxSorted, this.length);
      return orig.call(this, compareFn as (a: unknown, b: unknown) => number);
    });

    const devices: Device[] = Array.from({ length: 400 }, (_, i) => ({
      ip: `10.0.${(i >> 8) & 255}.${i & 255}`,
      mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
      ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "lan", online: true,
      packets: i % 50, bytes_in: 1, bytes_out: 1,
    }));
    const state = minimalState({ devices });
    const frame = buildVizFrame(state, 99, 0.2);
    expect(frame.talkers.length).toBeLessThanOrEqual(VIZ_MAX_TALKER_SAMPLES);
    expect(maxSorted).toBeLessThanOrEqual(VIZ_MAX_TALKER_SAMPLES);
  });

  it("returns capped talkers and packets for small fixtures", () => {
    const state = minimalState();
    const frame = buildVizFrame(state, 99, 0.2);
    expect(frame.t).toBe(100);
    expect(frame.dt).toBe(1);
    expect(frame.audio).toBe(0.2);
    expect(frame.packets).toHaveLength(2);
    expect(frame.talkers[0]?.id).toBe("192.168.1.3");
  });
});

function minimalState(overrides: Partial<StateMsg> = {}): StateMsg {
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
      pps: 10,
      bps: 1000,
      devices: 2,
      online: 2,
      flows: 1,
      active_flows: 1,
      packets: 100,
      bytes: 1000,
    },
    devices: [
      {
        ip: "192.168.1.3", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
        ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "lan", online: true,
        packets: 50, bytes_in: 1, bytes_out: 1,
      },
      {
        ip: "192.168.1.4", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
        ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "internet", online: true,
        packets: 10, bytes_in: 1, bytes_out: 1,
      },
    ],
    flows: [
      { a: "192.168.1.3", b: "8.8.8.8", bytes: 100, packets: 80, ports: [], protos: ["tcp"], ifaces: [], first_seen: 0, last_seen: 0, rate: 1 },
      { a: "192.168.1.4", b: "1.1.1.1", bytes: 20, packets: 20, ports: [], protos: ["udp"], ifaces: [], first_seen: 0, last_seen: 0, rate: 1 },
    ],
    ...overrides,
  };
}
