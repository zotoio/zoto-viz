import {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_10MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  VIZ_HUD_WINDOW_TICKS,
  VIZ_TICKS_PER_MS,
  VizTileBudgetRegistry,
  syncVizTileScope,
  hudSamplesForTile,
  syncVizTileSchedulerScope,
  vizTileBudgetRegistry,
} from "./viz-tile-budget";
import {
  computeTileHudViewerState,
  tileHudChrome,
  tileHudSkipRatePerSec,
} from "./viz-tile-hud";
import type { VizDataFrame } from "./viz-host";

export {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_10MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  VIZ_HUD_WINDOW_TICKS,
  syncVizTileScope,
  syncVizTileSchedulerScope,
};

const STEP_MS = VIZ_CLOCK_STEP_TICKS / VIZ_TICKS_PER_MS;

export function tileIdsForLayout(cols: number, rows: number): string[] {
  const n = cols * rows;
  return Array.from({ length: n }, (_, i) => `t${i}`);
}

export interface TileHudSimRow {
  delivered: number;
  skipped: number;
  skipRateAt: number;
  limitedLabel: string | null;
  state: ReturnType<typeof computeTileHudViewerState>;
}

export function runTileHudSim(
  registry: VizTileBudgetRegistry,
  tileId: string,
  attempts: number,
  costForAttempt: (i: number) => number,
  activeTiles: number,
  sampleIndex: number,
): TileHudSimRow {
  const build = (): VizDataFrame => ({
    t: 1,
    dt: 0,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
  });
  for (let i = 0; i < attempts; i++) {
    const tick = registry.currentTick();
    registry.deliver(
      tileId,
      () => ({ frame: build(), costTicks: costForAttempt(i) }),
      () => {},
      { tick, deliverIndex: i },
    );
    registry.advanceTick();
  }
  const tile = registry.getTile(tileId);
  const nowTick = sampleIndex * VIZ_CLOCK_STEP_TICKS;
  const chrome = tileHudChrome(tile, nowTick, activeTiles);
  return {
    delivered: tile.delivered,
    skipped: tile.skipped,
    skipRateAt: tileHudSkipRatePerSec(hudSamplesForTile(tile), nowTick),
    limitedLabel: chrome.limitedLabel,
    state: chrome.state,
  };
}

export function freshHudRegistry(tileIds: readonly string[]): VizTileBudgetRegistry {
  vizTileBudgetRegistry.reset();
  syncVizTileScope(tileIds);
  return vizTileBudgetRegistry;
}
