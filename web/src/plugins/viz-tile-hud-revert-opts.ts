import { VIZ_WALL_BUDGET_TICKS } from "./viz-tile-constants";
import type { VizTileHudSample } from "./viz-tile-budget";
import { tileHudSamplesInWindow } from "./viz-tile-hud";

export type TileHudViewerState = "none" | "limited" | "over_budget";

export interface TileHudStateOptions {
  inclusiveLower?: boolean;
  requireAllBuildsWithinWall?: boolean;
  useNoBuildFallback?: boolean;
  useLastBuildOnly?: boolean;
}

/** Revert / dogfood helper — not used by shipped HUD chrome. */
export function computeTileHudViewerStateWithOpts(
  samples: readonly VizTileHudSample[],
  nowTick: number,
  lastBuildCostTicks: number | null,
  opts: TileHudStateOptions = {},
): TileHudViewerState {
  const inclusiveLower = opts.inclusiveLower ?? false;
  const requireAllBuildsWithinWall = opts.requireAllBuildsWithinWall ?? true;
  const useNoBuildFallback = opts.useNoBuildFallback ?? true;
  const useLastBuildOnly = opts.useLastBuildOnly ?? false;

  const window = tileHudSamplesInWindow(samples, nowTick, inclusiveLower);
  const skipCount = window.filter((s) => s.kind === "skip").length;
  if (skipCount === 0) return "none";

  if (useLastBuildOnly && lastBuildCostTicks !== null) {
    return lastBuildCostTicks > VIZ_WALL_BUDGET_TICKS ? "over_budget" : "limited";
  }

  const builds = window.filter((s) => s.kind === "build");
  if (builds.length === 0) {
    if (!useNoBuildFallback) return "limited";
    if (lastBuildCostTicks === null) return "none";
    return lastBuildCostTicks > VIZ_WALL_BUDGET_TICKS ? "over_budget" : "limited";
  }

  if (!requireAllBuildsWithinWall) return "limited";

  const anyOverWall = builds.some((b) => (b.costTicks ?? 0) > VIZ_WALL_BUDGET_TICKS);
  if (anyOverWall) return "over_budget";
  return "limited";
}
