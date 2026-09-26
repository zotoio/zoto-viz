import { VIZ_HUD_WINDOW_TICKS, VIZ_WALL_BUDGET_TICKS } from "./viz-tile-constants";
import {
  hudSamplesForTile,
  tileSkipsInHudWindowRing,
  type VizTileBudgetStats,
  type VizTileHudSample,
} from "./viz-tile-budget";
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

/** Live tile HUD skip rate from the ring buffer (no sample array). */
export function tileHudSkipRateFromRing(
  tile: VizTileBudgetStats,
  nowTick: number,
  inclusiveLower = false,
): number {
  return tileSkipsInHudWindowRing(tile, nowTick, inclusiveLower);
}

export function computeTileHudViewerState(
  samples: readonly VizTileHudSample[],
  nowTick: number,
  lastBuildCostTicks: number | null,
): TileHudViewerState {
  const window = tileHudSamplesInWindow(samples, nowTick, false);
  const skipCount = window.filter((s) => s.kind === "skip").length;
  if (skipCount === 0) return "none";

  const builds = window.filter((s) => s.kind === "build");
  if (builds.length === 0) {
    if (lastBuildCostTicks === null) return "none";
    return lastBuildCostTicks > VIZ_WALL_BUDGET_TICKS ? "over_budget" : "limited";
  }

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
): TileHudChrome {
  const samples = hudSamplesForTile(tile);
  const skipRate = tileHudSkipRateFromRing(tile, nowTick, false);
  const state = computeTileHudViewerState(samples, nowTick, tile.lastBuildCostTicks);
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
