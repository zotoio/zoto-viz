import { afterEach, describe, expect, it } from "vitest";
import { resetVizClockInjectors } from "../core/viz-clock";
import { TILE_LIMITED_SHARING_TOOLTIP } from "../ui/viz-copy";
import {
  computeTileHudViewerState,
  tileHudSamplesInWindow,
  tileHudSkipRatePerSec,
} from "./viz-tile-hud";
import {
  freshHudRegistry,
  runTileHudSim,
  tileIdsForLayout,
  VIZ_COST_TICKS_10MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  syncVizTileSchedulerScope,
} from "./dogfood-tile-hud";
import {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_4MS,
  VIZ_COST_TICKS_50MS as COST_50,
  VIZ_HUD_SAMPLE_CAP,
  VIZ_MAX_ACTIVE_TILES,
  VIZ_WALL_BUDGET_TICKS,
  hudSamplesForTile,
  syncVizTileScope,
  tileShareTicks,
  vizTileBudgetRegistry,
} from "./viz-tile-budget";

describe("tile HUD rows (half-open window (now−300000, now] in ticks)", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
  });

  it("H1: 10 ms at 2×2 — debt 1748 → 2 skips per build; i=119 → 20 frames, 40 skipped/s LIMITED label", () => {
    // share 1252; build 3000 → debt 1748; two skips shed 1252+1252 → build every 3rd attempt.
    // Window at i=119: 60 attempts → 20 builds, 40 skips → 40/s.
    const tiles = tileIdsForLayout(2, 2);
    const reg = freshHudRegistry(tiles);
    const row = runTileHudSim(reg, "t0", 120, () => VIZ_COST_TICKS_10MS, 4, 119);
    expect(row.delivered).toBe(40);
    expect(row.skipRateAt).toBe(40);
    expect(row.limitedLabel).toBe("LIMITED · sharing frame with 3 tiles · 40 skipped/s");
    expect(row.state).toBe("limited");

    const solo = freshHudRegistry(["solo"]);
    const alone = runTileHudSim(solo, "solo", 120, () => VIZ_COST_TICKS_10MS, 1, 119);
    expect(alone.skipped).toBe(0);
    expect(alone.limitedLabel).toBeNull();
    expect(alone.state).toBe("none");
  });

  it("H2: 50 ms at 2×2 — 55 skipped/s at i=119 over budget; 1×1 → 40 skipped/s over budget", () => {
    const tiles = tileIdsForLayout(2, 2);
    const reg = freshHudRegistry(tiles);
    const row = runTileHudSim(reg, "t0", 120, () => VIZ_COST_TICKS_50MS, 4, 119);
    expect(row.skipRateAt).toBe(55);
    expect(row.state).toBe("over_budget");
    expect(row.limitedLabel).toBeNull();

    const solo = freshHudRegistry(["solo"]);
    const alone = runTileHudSim(solo, "solo", 120, () => VIZ_COST_TICKS_50MS, 1, 119);
    expect(alone.skipRateAt).toBe(40);
    expect(alone.state).toBe("over_budget");
  });

  it("H3: window edge — exactly 40 and 55 skipped/s at i=119", () => {
    const h1 = freshHudRegistry(tileIdsForLayout(2, 2));
    const r1 = runTileHudSim(h1, "t0", 120, () => VIZ_COST_TICKS_10MS, 4, 119);
    expect(r1.skipRateAt).toBe(40);

    const h2 = freshHudRegistry(tileIdsForLayout(2, 2));
    const r2 = runTileHudSim(h2, "t0", 120, () => VIZ_COST_TICKS_50MS, 4, 119);
    expect(r2.skipRateAt).toBe(55);
  });

  it("H4: alternating 3000/6000 at 2×2 — LIMITED then sticky over budget", () => {
    const tiles = tileIdsForLayout(2, 2);
    const reg = freshHudRegistry(tiles);
    const cost = (i: number) => (i % 2 === 0 ? VIZ_COST_TICKS_10MS : VIZ_COST_TICKS_20MS);
    let firstOver = -1;
    let firstLimited = -1;
    for (let i = 0; i < 120; i++) {
      const tick = reg.currentTick();
      reg.deliver("t0", () => ({ frame: { t: i, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] }, costTicks: cost(i) }), () => {}, { tick });
      reg.advanceTick();
      const tile = reg.getTile("t0");
      const nowTick = i * VIZ_CLOCK_STEP_TICKS;
      const state = computeTileHudViewerState(hudSamplesForTile(tile), nowTick, tile.lastBuildCostTicks);
      if (state === "limited" && firstLimited < 0) firstLimited = i;
      if (state === "over_budget" && firstOver < 0) firstOver = i;
      if (firstOver >= 0 && i >= firstOver) expect(state).toBe("over_budget");
    }
    expect(firstLimited).toBeGreaterThanOrEqual(0);
    expect(firstOver).toBeGreaterThan(firstLimited);
  });

  it("H5: direct scheduler — share 200, 15000 at i=0 → 74 skips then build at i=75; fallback over budget at i=74", () => {
    syncVizTileSchedulerScope(25, ["t0"]);
    const reg = vizTileBudgetRegistry;
    const frame = { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
    reg.deliver("t0", () => ({ frame, costTicks: COST_50 }), () => {}, { tick: 0 });
    expect(reg.getTile("t0").debt).toBe(14800);
    for (let i = 1; i <= 74; i++) {
      const res = reg.deliver("t0", () => ({ frame, costTicks: 1200 }), () => {}, { tick: i * VIZ_CLOCK_STEP_TICKS });
      expect(res.delivered).toBe(false);
    }
    expect(reg.getTile("t0").skipped).toBe(74);
    expect(reg.getTile("t0").lastBuildCostTicks).toBe(COST_50);
    const tile = reg.getTile("t0");
    const now74 = 74 * VIZ_CLOCK_STEP_TICKS;
    const windowBuilds = hudSamplesForTile(tile).filter(
      (s) => s.kind === "build" && s.tick > now74 - 300000 && s.tick <= now74,
    );
    expect(windowBuilds).toEqual([]);
    const inWin = tileHudSamplesInWindow(hudSamplesForTile(tile), now74);
    expect(inWin.filter((s) => s.kind === "build")).toEqual([]);
    expect(inWin.filter((s) => s.kind === "skip").length).toBeGreaterThan(0);
    const state74 = computeTileHudViewerState(hudSamplesForTile(tile), now74, tile.lastBuildCostTicks);
    expect(state74).toBe("over_budget");
    const build = reg.deliver("t0", () => ({ frame, costTicks: 1200 }), () => {}, { tick: 75 * VIZ_CLOCK_STEP_TICKS });
    expect(build.delivered).toBe(true);
  });

  it("layout shares: 1×1/2×2/2×3/2×4 → 5010/1252/835/626", () => {
    expect(tileShareTicks(1)).toBe(5010);
    expect(tileShareTicks(4)).toBe(1252);
    expect(tileShareTicks(6)).toBe(835);
    expect(tileShareTicks(8)).toBe(626);
  });

  it("HUD sample ring: 3600 frames keeps sample count at cap", () => {
    const reg = freshHudRegistry(["t0"]);
    const frame = { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
    for (let i = 0; i < 3600; i++) {
      reg.deliver("t0", () => ({ frame, costTicks: VIZ_COST_TICKS_4MS }), () => {}, { tick: i });
      reg.advanceTick();
    }
    expect(reg.getTile("t0").hudRingCount).toBeLessThanOrEqual(VIZ_HUD_SAMPLE_CAP);
    expect(reg.getTile("t0").hudRingCount).toBe(VIZ_HUD_SAMPLE_CAP);
  });

  it("scheduler clamp (extra): nine tile ids scope to share 626", () => {
    const nine = tileIdsForLayout(3, 3);
    expect(nine.length).toBe(9);
    syncVizTileScope(nine);
    expect(vizTileBudgetRegistry.activeTileCount()).toBe(VIZ_MAX_ACTIVE_TILES);
    expect(tileShareTicks(9)).toBe(626);
    expect(vizTileBudgetRegistry.getTile("t0").share).toBe(626);
  });
});

describe("tile HUD copy", () => {
  it("exposes LIMITED tooltip without ticks or shares", () => {
    expect(TILE_LIMITED_SHARING_TOOLTIP).not.toMatch(/5010|1252|tick/i);
  });
});
