import { afterEach, describe, expect, it } from "vitest";
import { resetVizClockInjectors } from "../core/viz-clock";
import { tileHudSkipRatePerSec } from "./viz-tile-hud";
import { computeTileHudViewerStateWithOpts } from "./viz-tile-hud-revert-opts";
import { hudSamplesForTile } from "./viz-tile-budget";
import {
  freshHudRegistry,
  runTileHudSim,
  tileIdsForLayout,
  VIZ_COST_TICKS_10MS,
  VIZ_COST_TICKS_50MS,
} from "./dogfood-tile-hud";
import { VIZ_CLOCK_STEP_TICKS, vizTileBudgetRegistry } from "./viz-tile-budget";

describe("tile HUD revert rows (sidecar expectations)", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
  });

  it("H1 revert A: without wall-fit check, 50 ms tile shows LIMITED", () => {
    const reg = freshHudRegistry(tileIdsForLayout(2, 2));
    const row = runTileHudSim(reg, "t0", 120, () => VIZ_COST_TICKS_50MS, 4, 119);
    expect(row.state).toBe("over_budget");
    const tile = reg.getTile("t0");
    const now = 119 * VIZ_CLOCK_STEP_TICKS;
    const reverted = computeTileHudViewerStateWithOpts(hudSamplesForTile(tile), now, tile.lastBuildCostTicks, {
      requireAllBuildsWithinWall: false,
    });
    expect(reverted).toBe("limited");
  });

  it("H3 revert: inclusive lower bound yields 41 and 56 skipped/s", () => {
    const h1 = freshHudRegistry(tileIdsForLayout(2, 2));
    runTileHudSim(h1, "t0", 120, () => VIZ_COST_TICKS_10MS, 4, 119);
    const t1 = h1.getTile("t0");
    const now = 119 * VIZ_CLOCK_STEP_TICKS;
    expect(tileHudSkipRatePerSec(hudSamplesForTile(t1), now, true)).toBe(41);

    const h2 = freshHudRegistry(tileIdsForLayout(2, 2));
    runTileHudSim(h2, "t0", 120, () => VIZ_COST_TICKS_50MS, 4, 119);
    const t2 = h2.getTile("t0");
    expect(tileHudSkipRatePerSec(hudSamplesForTile(t2), now, true)).toBe(56);
  });
});
