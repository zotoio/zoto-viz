import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVizClockInjectors } from "../core/viz-clock";
import { tileHudDisplayFrame, tileHudSkipLabel } from "../ui/viz-hud";
import {
  TILE_BUDGET_R1_EXPECTED,
  TILE_BUDGET_R2_NEXT_BUILD_ATTEMPT,
  TILE_BUDGET_R2_SKIPS_AFTER_SPIKE,
  TILE_BUDGET_R3_EXPECTED,
  TILE_BUDGET_R4_ALL_20MS,
  TILE_BUDGET_R4_PATTERN,
  TILE_BUDGET_R5_BUILD_CAP_TICKS,
  TILE_BUDGET_R5_HEAVY,
  TILE_BUDGET_R5_LIGHT_SKIPS,
  TILE_BUDGET_R5_TOTAL_BUILT_TICKS,
  TILE_BUDGET_R6_SPIKE_SKIPS,
  dogfoodPatternCostTicks,
  freshTileRegistry,
  runTileBudgetAttempts,
} from "./dogfood-tile-budget";
import {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_SPIKE_500MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_4MS,
  VIZ_COST_TICKS_50MS,
  syncVizTileScope,
  vizTileBudgetRegistry,
} from "./viz-tile-budget";
import type { VizDataFrame } from "./viz-host";

const frame = (tag: number): VizDataFrame => ({
  t: tag,
  dt: 0,
  audio: 0,
  packets: [],
  rf: [],
  talkers: [],
  headlines: [],
});

describe("tile frame budget rows", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
    vi.restoreAllMocks();
  });

  it("R1: 1x1 all 50 ms over 120 attempts", () => {
    const reg = freshTileRegistry(["t0"]);
    const sim = { value: 0 };
    const r = runTileBudgetAttempts(reg, "t0", 120, () => VIZ_COST_TICKS_50MS, { simTimeMs: sim });
    expect(r.delivered).toBe(TILE_BUDGET_R1_EXPECTED.delivered);
    expect(r.skipped).toBe(TILE_BUDGET_R1_EXPECTED.skipped);
  });

  it("R2: 1x1 spike then cadence k=30 — 29 skips before next build", () => {
    const reg = freshTileRegistry(["t0"]);
    const spike = reg.deliver("t0", () => ({ frame: frame(1), costTicks: VIZ_COST_SPIKE_500MS }), () => {}, { deliverIndex: 0 });
    expect(spike.delivered).toBe(true);
    for (let s = 0; s < TILE_BUDGET_R2_SKIPS_AFTER_SPIKE; s++) {
      const res = reg.deliver("t0", () => ({ frame: frame(1), costTicks: VIZ_COST_TICKS_4MS }), () => {}, { deliverIndex: s + 1 });
      expect(res.delivered).toBe(false);
    }
    expect(reg.getTile("t0").skipped).toBe(TILE_BUDGET_R2_SKIPS_AFTER_SPIKE);
    const next = reg.deliver(
      "t0",
      () => ({ frame: frame(2), costTicks: VIZ_COST_TICKS_4MS }),
      () => {},
      { deliverIndex: TILE_BUDGET_R2_NEXT_BUILD_ATTEMPT },
    );
    expect(next.delivered).toBe(true);
  });

  it("R3: cadence — 4 ms then 20 ms then 4 ms all deliver", () => {
    const reg = freshTileRegistry(["t0"]);
    const r = runTileBudgetAttempts(reg, "t0", 3, (i) => (
      i === 0 ? VIZ_COST_TICKS_4MS : i === 1 ? VIZ_COST_TICKS_20MS : VIZ_COST_TICKS_4MS
    ));
    expect(r.delivered).toBe(TILE_BUDGET_R3_EXPECTED.delivered);
    expect(r.skipped).toBe(TILE_BUDGET_R3_EXPECTED.skipped);
  });

  it("R4: every third 20 ms pattern unchanged", () => {
    const reg = freshTileRegistry(["t0"]);
    const sim = { value: 0 };
    const r = runTileBudgetAttempts(reg, "t0", 120, dogfoodPatternCostTicks, { simTimeMs: sim });
    expect(r.delivered).toBe(TILE_BUDGET_R4_PATTERN.delivered);
    expect(r.skipped).toBe(TILE_BUDGET_R4_PATTERN.skipped);
  });

  it("R4: 1x1 all 20 ms delivers 60 of 120", () => {
    const reg = freshTileRegistry(["t0"]);
    const r = runTileBudgetAttempts(reg, "t0", 120, () => VIZ_COST_TICKS_20MS);
    expect(r.delivered).toBe(TILE_BUDGET_R4_ALL_20MS.delivered);
    expect(r.skipped).toBe(TILE_BUDGET_R4_ALL_20MS.skipped);
  });

  it("R5: 2x2 one 50 ms tile and three 4 ms tiles", () => {
    const tiles = ["heavy", "a", "b", "c"];
    const reg = freshTileRegistry(tiles);
    const sim = { value: 0 };
    const heavy = runTileBudgetAttempts(reg, "heavy", 120, () => VIZ_COST_TICKS_50MS, { simTimeMs: sim });
    expect(heavy.delivered).toBe(TILE_BUDGET_R5_HEAVY.delivered);
    expect(heavy.skipped).toBe(TILE_BUDGET_R5_HEAVY.skipped);
    const reg2 = freshTileRegistry(tiles);
    const firstBuild = reg2.deliver("heavy", () => ({ frame: frame(1), costTicks: VIZ_COST_TICKS_50MS }), () => {}, { deliverIndex: 0 });
    expect(reg2.getTile("heavy").cadenceK).toBe(TILE_BUDGET_R5_HEAVY.cadenceK);
    expect(firstBuild.delivered).toBe(true);
    let totalBuilt = heavy.totalBuiltTicks;
    for (const id of ["a", "b", "c"]) {
      const light = runTileBudgetAttempts(reg, id, 120, () => VIZ_COST_TICKS_4MS, { simTimeMs: sim });
      expect(light.skipped).toBe(TILE_BUDGET_R5_LIGHT_SKIPS);
      totalBuilt += light.totalBuiltTicks;
    }
    expect(totalBuilt).toBe(TILE_BUDGET_R5_TOTAL_BUILT_TICKS);
    expect(totalBuilt).toBeLessThanOrEqual(TILE_BUDGET_R5_BUILD_CAP_TICKS);
  });

  it("R6: 2x2 spike on one tile yields 13 share skips", () => {
    const reg = freshTileRegistry(["t0", "t1", "t2", "t3"]);
    reg.deliver("t0", () => ({ frame: frame(1), costTicks: VIZ_COST_SPIKE_500MS }), () => {}, { deliverIndex: 0 });
    for (let i = 0; i < TILE_BUDGET_R6_SPIKE_SKIPS; i++) {
      const res = reg.deliver("t0", () => ({ frame: frame(1), costTicks: VIZ_COST_TICKS_4MS }), () => {}, { deliverIndex: i + 1 });
      expect(res.delivered).toBe(false);
    }
    expect(reg.getTile("t0").skipped).toBe(TILE_BUDGET_R6_SPIKE_SKIPS);
  });

  it("R7: share change recomputes cadence and clears HUD; view pick is inert", () => {
    const reg = freshTileRegistry(["t0"]);
    runTileBudgetAttempts(reg, "t0", 5, () => VIZ_COST_TICKS_50MS);
    expect(reg.getTile("t0").cadenceK).toBeGreaterThan(1);
    const before = reg.getTile("t0");
    before.hudRing[before.hudRingNext] = { tick: 1000, kind: "skip" };
    before.hudRingCount = 1;
    syncVizTileScope(["t0", "t1", "t2", "t3"]);
    expect(reg.getTile("t0").debt).toBe(0);
    expect(reg.getTile("t0").hudRingCount).toBe(0);
    expect(reg.getTile("t0").share).toBe(1252);
    expect(reg.getTile("t0").cadenceK).toBeGreaterThan(1);
    const cadenceBefore = reg.getTile("t0").cadenceK;
    reg.noteViewPick("t0");
    expect(reg.getTile("t0").cadenceK).toBe(cadenceBefore);
    expect(reg.getTile("t0").share).toBe(1252);
    reg.deliver("t0", () => ({ frame: frame(9), costTicks: VIZ_COST_SPIKE_500MS }), () => {}, { deliverIndex: 99 });
    expect(reg.getTile("t0").cadenceK).toBeGreaterThan(1);
    expect(reg.getTile("t0").share).toBe(1252);
  });

  it("R8: HUD over-budget skip rate and shedding keeps last frame", () => {
    const reg = freshTileRegistry(["t0"]);
    const f1 = frame(1);
    reg.deliver("t0", () => ({ frame: f1, costTicks: VIZ_COST_TICKS_50MS }), () => {}, { tick: 0 });
    reg.advanceTick();
    reg.deliver("t0", () => ({ frame: frame(2), costTicks: VIZ_COST_TICKS_4MS }), () => {}, { tick: reg.currentTick() });
    reg.advanceTick();
    const tile = reg.getTile("t0");
    expect(tileHudSkipLabel(tile, 55, 1, VIZ_CLOCK_STEP_TICKS)).toMatch(/^skips /);
    const shown = tileHudDisplayFrame(reg.getTile("t0"), null);
    expect(shown).toBe(f1);
    expect(shown?.t).toBe(1);
  });
});
