import { setVizBuildCostTicksInjector } from "../core/viz-clock";
import { skipRatePerSec } from "../ui/viz-hud";
import {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_4MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  VIZ_COST_SPIKE_500MS,
  VIZ_TICKS_PER_MS,
  VizTileBudgetRegistry,
  syncVizTileScope,
  vizTileBudgetRegistry,
} from "./viz-tile-budget";
import type { VizDataFrame } from "./viz-host";

export {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_4MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  VIZ_COST_SPIKE_500MS,
  syncVizTileScope,
};

const STEP_MS = VIZ_CLOCK_STEP_TICKS / VIZ_TICKS_PER_MS;

/** R1: share 5010, cost 15000 → +9990 debt; 2 share skips per deliver cycle → 40/120 delivers. */
export const TILE_BUDGET_R1_EXPECTED = { delivered: 40, skipped: 80 } as const;

/** R2: spike sets cadence k=30; next 29 frames skip before build at attempt 30. */
export const TILE_BUDGET_R2_SKIPS_AFTER_SPIKE = 29;
export const TILE_BUDGET_R2_NEXT_BUILD_ATTEMPT = 30;

/** R3: cadence — 4 ms / 20 ms / 4 ms all build (k stays 1–2, no debt skip). */
export const TILE_BUDGET_R3_EXPECTED = { delivered: 3, skipped: 0 } as const;

/** R4 cadence pattern: 100 delivers / 20 skips over 120 (20 ms every third slot). */
export const TILE_BUDGET_R4_PATTERN = { delivered: 100, skipped: 20, skipRatePerSec: 20 } as const;
export const TILE_BUDGET_R4_ALL_20MS = { delivered: 60, skipped: 60 } as const;

/** R5: 2×2 share 1252; 50 ms tile 10 delivers; 4 ms tiles 0 HUD skips; built 582000 ticks. */
export const TILE_BUDGET_R5_HEAVY = { delivered: 10, skipped: 110, cadenceK: 12 } as const;
export const TILE_BUDGET_R5_LIGHT_SKIPS = 0;
export const TILE_BUDGET_R5_TOTAL_BUILT_TICKS = 582000;
export const TILE_BUDGET_R5_BUILD_CAP_TICKS = 120 * 5010;

/** R6: 2×2 spike → cadence k=120; 13 consecutive share-limited skips. */
export const TILE_BUDGET_R6_SPIKE_SKIPS = 13;

export function dogfoodPatternCostTicks(index: number): number {
  return index % 3 === 2 ? VIZ_COST_TICKS_20MS : VIZ_COST_TICKS_4MS;
}

export interface TileAttemptResult {
  delivered: number;
  skipped: number;
  skipRatePerSec: number;
  debt: number;
  totalBuiltTicks: number;
  debtTrace: number[];
}

export function runTileBudgetAttempts(
  registry: VizTileBudgetRegistry,
  tileId: string,
  attempts: number,
  costForAttempt: (i: number) => number,
  opts?: {
    simTimeMs?: { value: number };
    build?: () => VizDataFrame;
  },
): TileAttemptResult {
  const build = opts?.build ?? (() => ({ t: 1, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] }));
  const sim = opts?.simTimeMs;
  let delivered = 0;
  let skippedStart = 0;
  const skipSamples: { t: number; n: number }[] = [];
  const debtTrace: number[] = [];
  let totalBuiltTicks = 0;

  setVizBuildCostTicksInjector((i) => costForAttempt(i));

  try {
    for (let i = 0; i < attempts; i++) {
      const cost = costForAttempt(i);
      const tick = registry.currentTick();
      const result = registry.deliver(
        tileId,
        () => ({ frame: build(), costTicks: cost }),
        () => {},
        { tick, deliverIndex: i },
      );
      registry.advanceTick();
      debtTrace.push(result.debt);
      if (result.delivered) {
        delivered++;
        totalBuiltTicks += cost;
      }
      const tile = registry.getTile(tileId);
      const delta = tile.skipped - skippedStart;
      if (delta > 0 && sim) {
        skipSamples.push({ t: sim.value, n: delta });
        skippedStart = tile.skipped;
      }
      if (sim) sim.value += STEP_MS;
    }
  } finally {
    setVizBuildCostTicksInjector(undefined);
  }

  const tile = registry.getTile(tileId);
  const nowMs = sim?.value ?? attempts * STEP_MS;
  return {
    delivered,
    skipped: tile.skipped,
    skipRatePerSec: skipRatePerSec(skipSamples, nowMs),
    debt: tile.debt,
    totalBuiltTicks,
    debtTrace,
  };
}

export function freshTileRegistry(tileIds: readonly string[]): VizTileBudgetRegistry {
  vizTileBudgetRegistry.reset();
  syncVizTileScope(tileIds);
  return vizTileBudgetRegistry;
}
