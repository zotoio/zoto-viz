import { VIZ_HUD_WINDOW_TICKS, VIZ_WALL_BUDGET_TICKS } from "./viz-tile-constants";
import type { VizTileBudgetStats, VizTileHudSample } from "./viz-tile-budget";
import { tileLimitedSharingLabel } from "../ui/viz-copy";

export type { VizTileHudSample, VizTileHudSampleKind } from "./viz-tile-budget";

export type TileHudViewerState = "none" | "limited" | "over_budget";

/** Half-open HUD window in ticks: (nowTick - {@link VIZ_HUD_WINDOW_TICKS}, nowTick]. */
export function hudWindowContains(tick: number, nowTick: number, inclusiveLower = false): boolean {
  const lo = nowTick - VIZ_HUD_WINDOW_TICKS;
  if (inclusiveLower) return tick >= lo && tick <= nowTick;
  return tick > lo && tick <= nowTick;
}

export function tileHudSamplesInWindow(
  samples: readonly VizTileHudSample[],
  nowTick: number,
  inclusiveLower = false,
): VizTileHudSample[] {
  return samples.filter((s) => hudWindowContains(s.tick, nowTick, inclusiveLower));
}

export function tileSkipsInHudWindow(
  samples: readonly VizTileHudSample[],
  nowTick: number,
  inclusiveLower = false,
): number {
  return tileHudSamplesInWindow(samples, nowTick, inclusiveLower).filter((s) => s.kind === "skip").length;
}

/** Skips in the half-open window scaled to a 1 s wall (window is 300000 ticks). */
export function tileHudSkipRatePerSec(
  samples: readonly VizTileHudSample[],
  nowTick: number,
  inclusiveLower = false,
): number {
  return tileSkipsInHudWindow(samples, nowTick, inclusiveLower);
}

export interface TileHudStateOptions {
  /** Half-open window uses inclusive lower bound (H3 revert). */
  inclusiveLower?: boolean;
  /** When false, any skip in the window yields LIMITED (H1 revert A). */
  requireAllBuildsWithinWall?: boolean;
  /** When false, skips with no builds in-window yield LIMITED instead of fallback (H5 revert). */
  useNoBuildFallback?: boolean;
  /** When true, classify from last build cost only (H4 revert). */
  useLastBuildOnly?: boolean;
}

export function computeTileHudViewerState(
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

export interface TileHudChrome {
  state: TileHudViewerState;
  limitedLabel: string | null;
  skipRatePerSec: number;
  useFailTone: boolean;
}

export function tileHudChrome(
  tile: VizTileBudgetStats,
  nowTick: number,
  activeTiles: number,
  opts?: TileHudStateOptions,
): TileHudChrome {
  const skipRate = tileHudSkipRatePerSec(
    tile.hudSamples,
    nowTick,
    opts?.inclusiveLower ?? false,
  );
  const state = computeTileHudViewerState(
    tile.hudSamples,
    nowTick,
    tile.lastBuildCostTicks,
    opts,
  );
  const limitedLabel =
    state === "limited"
      ? tileLimitedSharingLabel(activeTiles, skipRate)
      : null;
  return {
    state,
    limitedLabel,
    skipRatePerSec: skipRate,
    useFailTone: false,
  };
}
