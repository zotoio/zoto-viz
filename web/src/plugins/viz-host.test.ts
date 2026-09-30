import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVizClockInjectors, setVizBuildCostTicksInjector, setVizClockInjector } from "../core/viz-clock"
import { monoMs } from "../core/viz-time";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";
import type { Device, StateMsg } from "../core/types";
import {
  VIZ_DEFAULT_MAX_BUFFERS,
  VIZ_FRAME_BUDGET_MS,
  VIZ_MAX_TALKER_SAMPLES,
  VIZ_UBO,
  VIZ_UBO_GLSL,
  VizBufferWriter,
  VizFrameBudget,
  bindVizWriterCore,
  buildVizFrame,
  buildVizFrameForPlugin,
  defaultVizContract,
  parseVizContract,
  parseVizContractResult,
  pluginNeedsVizContract,
  topKByScore,
  VIZ_CONTRACT_VERSION,
} from "./viz-host";

beforeEach(() => {
  expect.hasAssertions();
});

describe("viz contract", () => {
  it("requires graphWalk false and viz.idle in schema parse", () => {
    expect(parseVizContract({ graphWalk: false, idle: { fixture: "host" } })).toBeDefined();
    expect(parseVizContract({ graphWalk: false })).toBeUndefined();
    expect(parseVizContract({ graphWalk: true, idle: { fixture: "host" } })).toBeUndefined();
    expect(parseVizContract(undefined)).toBeUndefined();
  });

  it("clamps buffer and particle caps", () => {
    const c = parseVizContract({
      graphWalk: false,
      idle: { fixture: "host" },
      maxBuffers: 99,
      maxBufferFloats: 4,
      maxParticles: 99999,
      hostMeshSlot: 3,
    });
    expect(c?.maxBuffers).toBe(8);
    expect(c?.maxBufferFloats).toBe(4);
    expect(c?.maxParticles).toBe(8192);
    expect(c?.hostMeshSlot).toBe(3);
  });

  it("attaches the fixed UBO layout and defaults pack contract to v1 when omitted", () => {
    const c = parseVizContract({ graphWalk: false, idle: { fixture: "host" } });
    expect(c?.contract).toBe(1);
    expect(c?.ubo).toEqual(VIZ_UBO);
    expect(c?.ubo.block).toBe("ZotoVizData");
    expect(c?.ubo.binding).toBe(0);
    expect(c?.ubo.totalBytes).toBe(2048);
    expect(VIZ_UBO_GLSL).toContain("uniform vec4 zotoVizSlots[128]");
    expect(VIZ_UBO_GLSL).not.toMatch(/binding\s*=/);
  });

  it("detects viz capabilities separately from graph.read", () => {
    expect(pluginNeedsVizContract(["viz.read"])).toBe(true);
    expect(pluginNeedsVizContract(["graph.read"])).toBe(false);
    expect(pluginNeedsVizContract(["graph.read", "viz.write"])).toBe(true);
  });

  it("exposes the frame budget constant", () => {
    expect(VIZ_FRAME_BUDGET_MS).toBeCloseTo(16.7, 1);
    expect(defaultVizContract().contract).toBe(VIZ_CONTRACT_VERSION);
    expect(defaultVizContract().maxBuffers).toBe(VIZ_DEFAULT_MAX_BUFFERS);
  });
});

describe("viz contract version negotiation", () => {
  const base = { graphWalk: false, idle: { fixture: "host" as const } };

  it("treats missing viz.contract as v1", () => {
    const r = parseVizContractResult(base);
    expect(r?.state).toBe("ready");
    if (r?.state !== "ready") return;
    expect(r.contract.contract).toBe(1);
  });

  it("accepts declared v2 packs", () => {
    const r = parseVizContractResult({ ...base, contract: 2 });
    expect(r?.state).toBe("ready");
    if (r?.state === "ready") expect(r.contract.contract).toBe(2);
  });

  it("blocks unknown viz.contract with a plain-language reason", () => {
    const r = parseVizContractResult({ ...base, contract: 9 });
    expect(r).toEqual({
      state: "Blocked",
      reason: "viz.contract 9 is not supported; use 1 or 2.",
    });
  });

  it("blocks string viz.contract values", () => {
    const r = parseVizContractResult({ ...base, contract: "2" });
    expect(r?.state).toBe("Blocked");
  });

  it("blocks boolean viz.contract values", () => {
    const r = parseVizContractResult({ ...base, contract: true });
    expect(r?.state).toBe("Blocked");
  });

  it("delivers v1 talker lifetime counts for v1 packs even when flow rates exist", () => {
    const state = minimalState();
    const frame = buildVizFrameForPlugin(state, monoMs(0), 0, { fixture: "host" }, 1);
    expect(frame.contract).toBe(1);
    expect(frame.links).toBeUndefined();
    expect(frame.talkers[0]?.rate).toBe(50);
  });

  it("delivers v2 enrichment for v2 packs", () => {
    const frame = buildVizFrameForPlugin(minimalState(), monoMs(0), 0, { fixture: "host" }, 2);
    expect(frame.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(frame.talkers[0]?.failed).toBeUndefined();
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
  beforeEach(() => {
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["bind"]);
  });

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
    let writer: VizBufferWriter | null = new VizBufferWriter(contract);
    writer.writeBuffer(0, [1, 2, 3, 4]);
    const uboBefore = writer.ubo.slice();

    let frameTs = 42.5;
    const budget = new VizFrameBudget(() => 0, "bind");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 15000 : 1200));
    budget.deliver(minimalState(), monoMs(frameTs), 0, () => {});
    budget.deliver(minimalState(), monoMs(frameTs), 0, () => {});
    setVizBuildCostTicksInjector(undefined);
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

    const budget = new VizFrameBudget(() => 0, "bind");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 15000 : 1200));
    budget.deliver(minimalState(), monoMs(10), 0, () => {});
    budget.deliver(minimalState(), monoMs(10), 0, () => {});
    setVizBuildCostTicksInjector(undefined);
    expect(budget.stats.skipped).toBe(1);

    const next = hostBindState(writer, 10, budget, false);
    expect(next.frameTs).toBe(0);
    expect(next.budget.stats.skipped).toBe(0);
    expect(next.writer).not.toBe(writer);
    expect(next.writer!.ubo[0]).toBe(0);
  });

  it("falls back to reset when preserveUbo is set but no prior writer exists", () => {
    const budget = new VizFrameBudget(() => 0, "bind");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 15000 : 1200));
    budget.deliver(minimalState(), monoMs(5), 0, () => {});
    budget.deliver(minimalState(), monoMs(5), 0, () => {});
    setVizBuildCostTicksInjector(undefined);

    const next = hostBindState(null, 5, budget, true);
    expect(next.frameTs).toBe(0);
    expect(next.budget.stats.skipped).toBe(0);
    expect(next.writer).not.toBeNull();
  });
});

describe("VizFrameBudget", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("counts over-budget frames and skips delivery", () => {
    const state = minimalState();
    const delivered: unknown[] = [];
    const onTime = new VizFrameBudget(() => 0);
    onTime.deliver(state, monoMs(0), 0, (f) => delivered.push(f));
    expect(delivered).toHaveLength(1);
    expect(onTime.stats.overBudget).toBe(0);
    expect(onTime.lastBuilt?.t).toBe(100);

    const slow = new VizFrameBudget(() => 0, "slow");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 1200 : i === 1 ? 15000 : 1200));
    slow.deliver(state, monoMs(0), 0, (f) => delivered.push(f));
    slow.deliver(state, monoMs(0), 0, (f) => delivered.push(f));
    const skipped = slow.deliver(state, monoMs(0), 0, (f) => delivered.push(f));
    setVizBuildCostTicksInjector(undefined);
    expect(skipped).toBeNull();
    expect(slow.stats.skipped).toBeGreaterThanOrEqual(1);
    expect(delivered.length).toBeGreaterThanOrEqual(2);
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
    resetVizClockInjectors();
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
    const frame = buildVizFrame(state, monoMs(99), 0.2);
    expect(frame.talkers.length).toBeLessThanOrEqual(VIZ_MAX_TALKER_SAMPLES);
    expect(maxSorted).toBeLessThanOrEqual(VIZ_MAX_TALKER_SAMPLES);
  });

  it("returns capped talkers and packets for small fixtures", () => {
    let clock = 90_000;
    setVizClockInjector(() => clock);
    const state = minimalState();
    const frame = buildVizFrame(state, monoMs(89_000), 0.2);
    expect(frame.t).toBe(100);
    expect(frame.dt).toBe(1);
    expect(frame.audio).toBe(0.2);
    expect(frame.packets).toHaveLength(2);
    expect(frame.talkers[0]?.id).toBe("192.168.1.3");
    expect(frame.headlines).toEqual([]);
  });

  it("extracts SYS gauges from host views", () => {
    const frame = buildVizFrame(minimalState({
      views: {
        cpu: {
          hub: "cpu:host",
          self: "cpu:host",
          devices: [{
            ip: "cpu:host", mac: "", vendor: "", hostnames: [], names: [], sources: [],
            ports: [], ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "self",
            online: true, packets: 1, bytes_in: 0, bytes_out: 0, cpu: 40,
          }],
          flows: [],
          thermal: { pkg_c: 80, rapl_w: 10, gpu_w: 100 },
        },
        memory: {
          hub: "mem:host",
          self: "mem:host",
          devices: [
            {
              ip: "mem:host", mac: "", vendor: "", hostnames: [], names: [], sources: [],
              ports: [], ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "self",
              online: true, packets: 1, bytes_in: 0, bytes_out: 0, cpu: 60,
            },
            {
              ip: "psi:cpu", mac: "", vendor: "", hostnames: [], names: [], sources: [],
              ports: [], ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "lan",
              online: true, packets: 1, bytes_in: 0, bytes_out: 0, cpu: 20,
            },
          ],
          flows: [],
        },
        units: {
          hub: "unit:host",
          self: "unit:host",
          devices: [{
            ip: "unit:host", mac: "", vendor: "", hostnames: [], names: [], sources: [],
            ports: [], ifaces: [], aliases: ["2 failed"], first_seen: 0, last_seen: 0, role: "self",
            online: true, packets: 1, bytes_in: 0, bytes_out: 0, cpu: 80,
          }],
          flows: [],
        },
      },
    }), monoMs(99), 0);
    expect(frame.sys?.cpu).toBeCloseTo(0.4);
    expect(frame.sys?.mem).toBeCloseTo(0.6);
    expect(frame.sys?.temp).toBeCloseTo(0.8);
    expect(frame.sys?.watts).toBeCloseTo(0.5);
    expect(frame.sys?.psi).toBeCloseTo(0.2);
    expect(frame.sys?.failed).toBeCloseTo(0.5);
  });

  it("passes host source headlines into the viz frame", () => {
    const frame = buildVizFrame(minimalState({
      sources: {
        hn: {
          id: "hn", kind: "rss", label: "Hacker News", ok: true, feed: true,
          items: [
            { title: "Jemalloc", summary: "<b>alloc</b> news", image: "https://www.nasa.gov/iotd.jpg" },
            { title: "Waymo" },
          ],
        },
      },
    }), monoMs(99), 0, { source: "hn" });
    expect(frame.headlines.map((h) => h.text)).toEqual(["Jemalloc", "Waymo"]);
    expect(frame.headlines[0]?.summary).toBe("alloc news");
    expect(frame.headlines[0]?.image).toBe("https://www.nasa.gov/iotd.jpg");
    expect(frame.headlines.every((h) => h.kind === "rss")).toBe(true);
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
