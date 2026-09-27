import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetVizClockInjectors,
  setVizBuildCostTicksInjector,
} from "../core/viz-clock"
import { monoMs } from "../core/viz-time";
import { formatSkipRate, skipRatePerSec, vizHudMetric } from "../ui/viz-hud";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  DEMO_PACK_CONTRACTS,
  dogfoodTick,
  dogfoodWithinBudget,
  formatDogfoodReport,
  hostBindOnPackSwap,
  hudTickFromBudget,
  runDogfoodSoak,
  runPackFrameHandler,
  runPackSwapPreserve,
} from "./dogfood-runner";
import { VIZ_FIXTURE_IDLE, VIZ_FIXTURE_GOLDEN_LIVE } from "../../../plugins/sdk/viz-fixtures";
import { packetTunnelFields } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import { packHnRainBuffer, packHnTermBuffer, packStereoDrive } from "./viz-pack-host";
import {
  easeStereoBins, parseStereoTiming, STEREO_BANDS, STEREO_BINS, STEREO_GAP, STEREO_RACKS,
  STEREO_RISE_MS, STEREO_SOLIDS, STEREO_HOLD, STEREO_MORPH, STEREO_MOTION_BANDS, STEREO_MOVE,
  STEREO_PALETTE_SECONDS, STEREO_REPEAT, STEREO_SPEED, STEREO_STILL,
} from "../../../plugins/src/stereo-gram/frontend/drive";
import {
  VIZ_FRAME_BUDGET_MS,
  VizBufferWriter,
  VizFrameBudget,
  buildVizFrame,
  buildVizFrameForPlugin,
} from "./viz-host";
import type { StateMsg } from "../core/types";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";

describe("hn rain pack", () => {
  it("packs uppercase headline bytes the sky can decode", () => {
    const buf = packHnRainBuffer(
      [{ id: "hn:0", label: "Hacker News", text: "Jemalloc" }],
      0.2,
      0.1,
    );
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBeCloseTo(8 / 60);
    expect(buf.length).toBe(9 + 8);
    expect(Math.round(buf[9]! * 95) + 32).toBe("J".charCodeAt(0));
  });
});

describe("stereo gram pack", () => {
  it("packs traffic level, object, palette, burst and pattern settings into one slot", () => {
    const timing = {
      hold: 20, morph: 4, palette: "timer" as const, paletteSeconds: 45, still: 5, move: 1.5,
      repeat: 7, bands: 18, motionBands: 2.5, speed: 0.5, audio: true, shape: "oblong" as const, ai: true,
      spacing: 1,
      rack: parseStereoTiming().rack,
    };
    const bins = Array.from({ length: STEREO_BINS }, (_, i) => i / STEREO_BINS);
    const buf = packStereoDrive([{ rate: 100 }, { rate: 50 }], timing, { level: 0.4, clock: 1.5, bins });
    expect(buf).toHaveLength(32);
    expect(buf[0]).toBeCloseTo(1 - Math.exp(-1));
    expect(buf[1]).toBeCloseTo(0.25);
    expect(buf.slice(2, 11)).toEqual([20, 4, 1, 45, 5, 1.5, 7, 18, 2.5]);
    expect(buf[11]).toBeCloseTo(0.5);
    expect(buf[12]).toBe(1);
    expect(buf[13]).toBeCloseTo(0.4);
    expect(buf[14]).toBeCloseTo(1.5);
    expect(buf[15]).toBe(0);
    expect(buf.slice(16, 16 + STEREO_BINS)).toEqual(bins);
    expect(buf.slice(16 + STEREO_BINS)).toEqual(new Array(32 - 16 - STEREO_BINS).fill(0));
    const head = [1, 3, 0.5, 0.02, 0.1, -0.1, 0.3, 0];
    expect(packStereoDrive([], timing, { scene: head }).slice(24)).toEqual(head);
    expect(packStereoDrive([], timing, { scene: [1, 2] }).slice(24)).toEqual(new Array(8).fill(0));
    expect(packStereoDrive([], { ...timing, shape: "cubes" })[15]).toBe(1);
    expect(packStereoDrive([], { ...timing, shape: "balls" })[15]).toBe(2);
    expect(packStereoDrive([], { ...timing, shape: "morph" })[15]).toBe(3);
    expect(packStereoDrive([], { ...timing, palette: "objects", audio: false })[4]).toBe(0);
    expect(packStereoDrive([], { ...timing, audio: false })[12]).toBe(0);
  });

  it("eases bins like a meter: quick rise, slower fall", () => {
    const rise = STEREO_RISE_MS.def / 1000;
    const up = easeStereoBins([0], [1], rise)[0]!;
    expect(up).toBeCloseTo(1 - Math.exp(-1));
    const down = easeStereoBins([1], [0], rise)[0]!;
    expect(down).toBeGreaterThan(1 - up);
    expect(easeStereoBins([0.5], [0.2], 0)).toEqual([0.5]);
    expect(easeStereoBins([], [0.3, 0.6], 10)[1]).toBeCloseTo(0.6);
    expect(easeStereoBins([0], [1], 0.05, 0.05, 1)[0]).toBeCloseTo(1 - Math.exp(-1));
  });

  it("picks rack spacing from a preset or the custom sliders", () => {
    const a = parseStereoTiming().rack;
    expect(a).toEqual({
      preset: "c", ...STEREO_RACKS.c, growth: 1, depth: 0.4, origin: 0.25, ballGrow: "stretch", rise: 0.15, fall: 0.5,
    });
    expect(parseStereoTiming({ ballGrow: "swell" }).rack.ballGrow).toBe("swell");
    expect(parseStereoTiming({ rack: "a" }).rack).toMatchObject({ preset: "a", solids: 6, gap: 1.6 });
    expect(parseStereoTiming({ rack: "d", solids: "3", gap: "1" }).rack).toMatchObject({ preset: "d", ...STEREO_RACKS.d });
    expect(parseStereoTiming({ rack: "custom", solids: "9", gap: "0.1", width: "2" }).rack)
      .toMatchObject({ preset: "custom", solids: STEREO_SOLIDS.max, gap: STEREO_GAP.min, width: 2 });
    expect(parseStereoTiming({ rack: "zzz", origin: "-300", depth: "-5", rise: "1000" }).rack)
      .toMatchObject({ preset: "c", origin: -1, depth: 0, rise: 0.6 });
    expect(parseStereoTiming({ spacing: "999" }).spacing).toBe(2);
    expect(parseStereoTiming({ spacing: "10" }).spacing).toBe(0.5);
  });

  it("reads timing from view config, clamped, with defaults", () => {
    const defaults = {
      hold: STEREO_HOLD.def, morph: STEREO_MORPH.def, palette: "objects", paletteSeconds: STEREO_PALETTE_SECONDS.def,
      still: STEREO_STILL.def, move: STEREO_MOVE.def,
      repeat: STEREO_REPEAT.def, bands: STEREO_BANDS.def, motionBands: STEREO_MOTION_BANDS.def,
      speed: STEREO_SPEED.def / 100, audio: true, shape: "morph" as const, ai: true,
      spacing: 1,
      rack: parseStereoTiming().rack,
    };
    expect(parseStereoTiming()).toEqual(defaults);
    expect(parseStereoTiming({ hold: "", morph: "abc", palette: "rainbow" })).toEqual(defaults);
    expect(parseStereoTiming({
      hold: "30", morph: "5", palette: "timer", paletteSeconds: "60", still: "0", move: "3",
      repeat: "6", bands: "20.4", motionBands: "3",
    })).toEqual({
      hold: 30, morph: 5, palette: "timer", paletteSeconds: 60, still: 0, move: 3, repeat: 6, bands: 20, motionBands: 3,
      speed: 0.5, audio: true, shape: "morph", ai: true, spacing: 1, rack: parseStereoTiming().rack,
    });
    expect(parseStereoTiming({ ai: "false", shape: "balls" })).toMatchObject({ ai: false, shape: "balls" });
    expect(parseStereoTiming({ hold: "1", morph: "99", paletteSeconds: "1", move: "0" }))
      .toEqual({
        ...defaults, hold: STEREO_HOLD.min, morph: STEREO_MORPH.max, paletteSeconds: STEREO_PALETTE_SECONDS.min,
        move: STEREO_MOVE.min,
      });
  });
});

describe("hn term pack", () => {
  it("packs a typed screen the sky can decode", () => {
    const buf = packHnTermBuffer(
      [{ id: "hn:0", label: "Hacker News", text: "Jemalloc", summary: "A new allocator." }],
      20,
      0.2,
      1,
    );
    expect(buf[0]).toBe(14);
    expect(buf[1]).toBe(4);
    expect(buf.length).toBe(8 + 14 * 4);
    expect(buf.length).toBeLessThanOrEqual(64);
    expect(buf.slice(8).some((v) => Math.round(v * 95) + 32 === "J".charCodeAt(0))).toBe(true);
  });
});

describe("viz dogfood gates", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["dogfood"]);
  });

  afterEach(() => {
    resetVizClockInjectors();
    vi.restoreAllMocks();
  });

  const fatLan = fatLanFixture();

  it("over-budget tick bumps skip counter and withholds pack delivery", () => {
    const packId = "packet-tunnel";
    const contract = DEMO_PACK_CONTRACTS[packId];
    const writer = new VizBufferWriter(contract);
    const budget = new VizFrameBudget(() => 0, "t-over");
    setVizBuildCostTicksInjector((i) => (i < 2 ? (i === 0 ? 1200 : 15000) : 1200));

    const ok = dogfoodTick(packId, fatLan, 0, 0.1, budget, writer);
    expect(ok.delivered).toBe(true);
    let prevClock = 0;
    const heavy = dogfoodTick(packId, fatLan, prevClock, 0.1, budget, writer);
    prevClock = 1000;
    expect(heavy.delivered).toBe(true);
    const skipped = dogfoodTick(packId, fatLan, prevClock, 0.1, budget, writer);
    expect(skipped.delivered).toBe(false);
    expect(skipped.lastBuilt).not.toBeNull();
    expect(budget.stats.skipped).toBe(1);
    setVizBuildCostTicksInjector(undefined);
  });

  it("packet-tunnel host idle yields non-zero buffer and bright on empty state", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    let bright = 0;
    const frame = VIZ_FIXTURE_IDLE;
    expect(frame.packets.length).toBeGreaterThan(0);
    runPackFrameHandler("packet-tunnel", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => {
        writer.writeUniform(name, value);
        if (name === "uBright" && typeof value === "number") bright = value;
      },
      writeParticles: () => {},
    });
    const buf = Array.from(writer.snapshot(0));
    expect(buf[0]).toBeGreaterThan(0.25);
    expect(buf[1]).toBeGreaterThan(0.25);
    expect(bright).toBeGreaterThan(0.4);
  });

  it("talker-storm host idle yields particles on empty state", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["talker-storm"]);
    const frame = VIZ_FIXTURE_IDLE;
    expect(frame.talkers.length).toBeGreaterThan(0);
    runPackFrameHandler("talker-storm", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => { writer.writeUniform(name, value); },
      writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
    });
    expect(writer.particleSnapshot().length).toBeGreaterThan(0);
    expect(writer.snapshot(0)[0]).toBeGreaterThan(0);
  });

  it("packet-tunnel prefers live packets over host idle", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    let bright = 0;
    const frame = VIZ_FIXTURE_GOLDEN_LIVE;
    runPackFrameHandler("packet-tunnel", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => {
        writer.writeUniform(name, value);
        if (name === "uBright" && typeof value === "number") bright = value;
      },
      writeParticles: () => {},
    });
    const buf = Array.from(writer.snapshot(0));
    expect(buf[0]).toBeCloseTo(frame.packets[0]!.field);
    expect(buf[1]).toBeGreaterThan(0);
    expect(bright).toBeGreaterThan(0.4);
  });

  it("talker-storm pack handler refuses more than 512 particles", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["talker-storm"]);
    const frame = buildVizFrame(fatLan, monoMs(0), 0.1);
    const over: number[] = [];
    for (let i = 0; i < 513; i++) over.push(0, 0, 0, 1);
    const bad = writer.writeParticles(over, 4);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/512/);

    runPackFrameHandler("talker-storm", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => { writer.writeUniform(name, value); },
      writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
    });
    expect(writer.particleSnapshot().length).toBeLessThanOrEqual(512 * 4);
  });

  it("preserve-frame across mid-run pack swap keeps vizFrameTs, skips, and UBO mirror", () => {
    setVizBuildCostTicksInjector((i) => (i === 1 || i === 3 ? 15000 : 1200));
    const times = [0, 4, 0, VIZ_FRAME_BUDGET_MS + 3, 0, 5, 0, 4];
    let tick = 0;
    const result = runPackSwapPreserve(
      fatLan,
      "packet-tunnel",
      "rf-constellation",
      () => times[tick++] ?? 999,
    );

    expect(result.frameTs).toBeGreaterThan(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.uboMatch).toBe(true);
    setVizBuildCostTicksInjector(undefined);

    const budget = new VizFrameBudget(() => 0, "swap");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 1200 : 15000));
    budget.deliver(fatLan, monoMs(0), 0.1, () => {});
    budget.deliver(fatLan, monoMs(0), 0.1, () => {});
    expect(budget.stats.skipped).toBeGreaterThanOrEqual(1);
    setVizBuildCostTicksInjector(undefined);

    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    writer.writeBuffer(0, [9, 8, 7, 6]);
    const rebound = hostBindOnPackSwap(
      writer,
      DEMO_PACK_CONTRACTS["talker-storm"],
      result.frameTs,
      budget,
      true,
    );
    expect(rebound.frameTs).toBe(result.frameTs);
    expect(rebound.budget.stats.skipped).toBeGreaterThanOrEqual(1);
    expect(Array.from(rebound.writer!.ubo).slice(0, 4)).toEqual([9, 8, 7, 6]);
  });

  it("HUD metrics use only lastBuilt and stats — one buildVizFrame per tick", () => {
    const packId = "rf-constellation";
    const contract = DEMO_PACK_CONTRACTS[packId];
    const writer = new VizBufferWriter(contract);
    const budget = new VizFrameBudget();
    const buildSpy = vi.fn(buildVizFrame);
    const spy = { calls: 0 };

    const tick = dogfoodTick(packId, fatLan, 0, 0.2, budget, writer, spy, buildSpy);
    expect(spy.calls).toBe(1);
    expect(buildSpy).toHaveBeenCalledTimes(1);

    const hud = hudTickFromBudget(packId, "RF Constellation", fatLan, budget, 1000);
    const metric = vizHudMetric(packId, hud.frame, hud.state);
    expect(metric.label).toBe("RF");
    expect(hud.frame).toBe(budget.lastBuilt);
    expect(tick.lastBuilt).toBe(budget.lastBuilt);

    // Simulate HUD skip display from cumulative counter only
    const skipSamples = budget.stats.skipped > 0 ? [{ t: 1000, n: budget.stats.skipped }] : [];
    expect(formatSkipRate(skipRatePerSec(skipSamples, 1000))).toBe("skips 0/s");
  });

  it("fat-LAN live soak: all three packs under budget or honest skips", () => {
    const result = runDogfoodSoak({ state: fatLan, framesPerPack: 120 });
    console.log("\n" + formatDogfoodReport(result));

    expect(result.fixture.devices).toBeGreaterThanOrEqual(300);
    expect(result.fixture.flows).toBeGreaterThanOrEqual(1000);
    expect(result.packs.length).toBeGreaterThanOrEqual(3);
    expect(result.packs.map((p) => p.packId)).toEqual(expect.arrayContaining([
      "packet-tunnel",
      "rf-constellation",
      "talker-storm",
      "kefrens-bars",
      "roto-proto",
      "blob-mesh",
      "star-sines",
      "hn-rain",
      "hn-term",
      "stereo-gram",
      "nixie-clock",
    ]));

    for (const pack of result.packs) {
      expect(pack.buildMs.p95).toBeLessThan(VIZ_FRAME_BUDGET_MS + 0.01);
      expect(pack.delivered).toBe(pack.frames);
      expect(pack.skipped).toBe(0);
      expect(pack.withinBudget).toBe(true);
    }
    expect(result.allWithinBudgetOrHonestSkips).toBe(true);
  });
});

describe("viz dogfood over-budget honesty", () => {
  it("dogfood gate fails on soft-FPS when skips stay blank", () => {
    expect(dogfoodWithinBudget(5, 25, 0)).toBe(false);
    expect(dogfoodWithinBudget(5, 25, 3)).toBe(true);
    expect(dogfoodWithinBudget(20, 10, 0)).toBe(false);
  });

  it("records present-time skips when synthetic frame dt exceeds budget", () => {
    const fatLan = fatLanFixture();
    const result = runDogfoodSoak({
      state: fatLan,
      framesPerPack: 40,
      presentStepMs: 25,
    });

    for (const pack of result.packs) {
      expect(pack.skipped).toBeGreaterThan(0);
      expect(pack.withinBudget).toBe(true);
      expect(formatSkipRate(skipRatePerSec([{ t: 1000, n: pack.skipped }], 2000))).not.toBe("skips 0/s");
    }
    expect(result.allWithinBudgetOrHonestSkips).toBe(true);
  });

  it("empty StateMsg dogfood tick still delivers idle-backed frames", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    const budget = new VizFrameBudget();
    const tick = dogfoodTick("packet-tunnel", emptyState(), 0, 0, budget, writer);
    expect(tick.delivered).toBe(true);
    expect(tick.frame?.packets.length).toBeGreaterThan(0);
    expect(writer.snapshot(0)[0]).toBeGreaterThan(0);
  });

  it("records skips when build is injected slow — never silent green", () => {
    const fatLan = fatLanFixture();
    const packId = "talker-storm";
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS[packId]);
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["slow"]);
    const budget = new VizFrameBudget(() => 0, "slow");
    setVizBuildCostTicksInjector((i) => (i < 2 ? (i === 0 ? 1200 : 15000) : 1200));

    const first = dogfoodTick(packId, fatLan, 0, 0.1, budget, writer);
    expect(first.delivered).toBe(true);

    const heavy = dogfoodTick(packId, fatLan, first.frame?.t ?? 0, 0.1, budget, writer);
    expect(heavy.delivered).toBe(true);
    const second = dogfoodTick(packId, fatLan, heavy.frame?.t ?? 0, 0.1, budget, writer);
    expect(second.delivered).toBe(false);
    setVizBuildCostTicksInjector(undefined);
    expect(second.lastBuilt).not.toBeNull();
    expect(budget.stats.skipped).toBe(1);

    const hud = hudTickFromBudget(packId, "Talker Storm", fatLan, budget, 2000);
    const samples = [{ t: 1900, n: 1 }];
    expect(formatSkipRate(skipRatePerSec(samples, 2000))).not.toBe("skips 0/s");
    expect(vizHudMetric(packId, hud.frame, hud.state).label).toBe("particles");
  });
});

function emptyState(): StateMsg {
  return {
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
}
