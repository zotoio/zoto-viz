import { describe, expect, it, vi } from "vitest";
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
import { packHnRainBuffer, packHnTermBuffer, packStereoOrbs } from "./viz-pack-host";
import {
  VIZ_FRAME_BUDGET_MS,
  VizBufferWriter,
  VizFrameBudget,
  buildVizFrame,
} from "./viz-host";

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
  it("packs talker orbs for the depth field", () => {
    const buf = packStereoOrbs([{ id: "10.0.0.1", rate: 80, role: "lan" }], 0);
    expect(buf.length).toBe(4);
    expect(buf[2]).toBeGreaterThan(0.1);
    expect(buf[3]).toBeCloseTo(0.45);
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
  const fatLan = fatLanFixture();

  it("over-budget tick bumps skip counter and withholds pack delivery", () => {
    const packId = "packet-tunnel";
    const contract = DEMO_PACK_CONTRACTS[packId];
    const writer = new VizBufferWriter(contract);
    const times = [0, 5, 0, VIZ_FRAME_BUDGET_MS + 4];
    let tick = 0;
    const budget = new VizFrameBudget(() => times[tick++] ?? 999);
    let delivered = 0;

    const ok = dogfoodTick(packId, fatLan, 0, 0.1, budget, writer);
    expect(ok.delivered).toBe(true);
    expect(ok.buildCalls).toBe(1);
    expect(budget.stats.skipped).toBe(0);

    const prevTs = ok.frame?.t ?? 0;
    const skipped = dogfoodTick(packId, fatLan, prevTs, 0.1, budget, writer);
    expect(skipped.delivered).toBe(false);
    expect(skipped.frame).toBeNull();
    expect(skipped.lastBuilt).not.toBeNull();
    expect(budget.stats.skipped).toBe(1);
    expect(budget.stats.overBudget).toBe(1);
    if (skipped.delivered) delivered++;
    expect(delivered).toBe(0);
  });

  it("packet-tunnel demo fallback animates buffer and bright with no packets", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    let bright = 0;
    const frame = {
      t: 1.5,
      dt: 0,
      audio: 0,
      packets: [] as { proto: string; size: number; field: number }[],
      rf: [],
      talkers: [],
      headlines: [],
    };
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

  it("packet-tunnel prefers live packets over demo fallback", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    let bright = 0;
    const frame = buildVizFrame(fatLan, 0, 0.1);
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
    const frame = buildVizFrame(fatLan, 0, 0.1);
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

    const budget = new VizFrameBudget(() => 0);
    let n = 0;
    budget.deliver(fatLan, 0, 0.1, () => {});
    expect(budget.stats.skipped).toBe(0);
    const slow = new VizFrameBudget(() => (++n === 1 ? 0 : VIZ_FRAME_BUDGET_MS + 1));
    slow.deliver(fatLan, 0, 0.1, () => {});
    expect(slow.stats.skipped).toBe(1);

    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    writer.writeBuffer(0, [9, 8, 7, 6]);
    const rebound = hostBindOnPackSwap(
      writer,
      DEMO_PACK_CONTRACTS["talker-storm"],
      result.frameTs,
      slow,
      true,
    );
    expect(rebound.frameTs).toBe(result.frameTs);
    expect(rebound.budget.stats.skipped).toBe(1);
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

  it("records skips when build is injected slow — never silent green", () => {
    const fatLan = fatLanFixture();
    const packId = "talker-storm";
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS[packId]);
    const times = [0, 5, 0, VIZ_FRAME_BUDGET_MS + 2];
    let tick = 0;
    const budget = new VizFrameBudget(() => times[tick++] ?? 999);

    const first = dogfoodTick(packId, fatLan, 0, 0.1, budget, writer);
    expect(first.delivered).toBe(true);

    const second = dogfoodTick(packId, fatLan, first.frame?.t ?? 0, 0.1, budget, writer);
    expect(second.delivered).toBe(false);
    expect(second.lastBuilt).not.toBeNull();
    expect(budget.stats.skipped).toBe(1);

    const hud = hudTickFromBudget(packId, "Talker Storm", fatLan, budget, 2000);
    const samples = [{ t: 1900, n: 1 }];
    expect(formatSkipRate(skipRatePerSec(samples, 2000))).not.toBe("skips 0/s");
    expect(vizHudMetric(packId, hud.frame, hud.state).label).toBe("particles");
  });
});
