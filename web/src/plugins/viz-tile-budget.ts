import type { VizDataFrame } from "./viz-host";

/** 1 tick = 1/300 ms (integer budget clock). */
export const VIZ_TICKS_PER_MS = 300;

/** 16.7 ms wall budget in ticks. */
export const VIZ_WALL_BUDGET_TICKS = 5010;

/** Fixed debt cap: 3 × wall budget (never scales with tile share). */
export const VIZ_DEBT_CAP_TICKS = 15030;

/** HUD rolling window (1000 ms). */
export const VIZ_HUD_WINDOW_TICKS = 300000;

/** 60 Hz sim step in ticks. */
export const VIZ_CLOCK_STEP_TICKS = 5000;

export const VIZ_COST_TICKS_4MS = 1200;
export const VIZ_COST_TICKS_20MS = 6000;
export const VIZ_COST_TICKS_50MS = 15000;
export const VIZ_COST_SPIKE_500MS = 150000;

export function msToVizTicks(ms: number): number {
  return Math.round(ms * VIZ_TICKS_PER_MS);
}

export function tileShareTicks(activeTiles: number): number {
  const n = Math.max(1, activeTiles);
  return Math.floor(VIZ_WALL_BUDGET_TICKS / n);
}

export function debtIsClear(debt: number): boolean {
  return debt <= 0;
}

export interface VizTileBudgetStats {
  debt: number;
  share: number;
  skipped: number;
  delivered: number;
  shareLimitedSkips: number;
  shedding: boolean;
  lastDeliveredFrame: VizDataFrame | null;
}

function freshTile(share: number): VizTileBudgetStats {
  return {
    debt: 0,
    share,
    skipped: 0,
    delivered: 0,
    shareLimitedSkips: 0,
    shedding: false,
    lastDeliveredFrame: null,
  };
}

function clampDebt(debt: number): number {
  let d = debt;
  if (d < 0) d = 0;
  if (d > VIZ_DEBT_CAP_TICKS) d = VIZ_DEBT_CAP_TICKS;
  return d;
}

/**
 * Per-tile frame debt ledger. Share is keyed by tile id and recomputed only in
 * {@link syncVizTileScope} (mosaic / sandbox teardown), which zeroes debt when share changes.
 */
export class VizTileBudgetRegistry {
  private readonly tiles = new Map<string, VizTileBudgetStats>();
  private activeTiles = 1;

  getTile(tileId: string): VizTileBudgetStats {
    const share = tileShareTicks(this.activeTiles);
    let t = this.tiles.get(tileId);
    if (!t) {
      t = freshTile(share);
      this.tiles.set(tileId, t);
    }
    return t;
  }

  stats(tileId: string): VizTileBudgetStats {
    return { ...this.getTile(tileId) };
  }

  activeTileCount(): number {
    return this.activeTiles;
  }

  /**
   * Scope sync after sandbox teardown / mosaic tile set change.
   * Recomputes share and zeroes debt for tiles whose share changed.
   */
  syncScope(activeTileIds: readonly string[]): void {
    const n = Math.max(1, activeTileIds.length);
    const share = tileShareTicks(n);
    this.activeTiles = n;
    const keep = new Set(activeTileIds);
    for (const id of keep) {
      const t = this.getTile(id);
      if (t.share !== share) {
        t.share = share;
        t.debt = 0;
      }
    }
  }

  /** View pick inside one tile — must not change share or debt. */
  noteViewPick(_tileId: string): void {
    /* intentional no-op */
  }

  reset(): void {
    this.tiles.clear();
    this.activeTiles = 1;
  }

  /**
   * One deliver attempt for a tile.
   * - debt > 0: skip (share limit), debt -= share, floor at 0
   * - else build, debt += cost - share, floor at 0, cap at {@link VIZ_DEBT_CAP_TICKS}
   */
  deliver(
    tileId: string,
    attempt: () => { frame: VizDataFrame; costTicks: number },
    onFrame: (frame: VizDataFrame) => void,
  ): { delivered: boolean; frame: VizDataFrame | null; debt: number } {
    const tile = this.getTile(tileId);
    if (!debtIsClear(tile.debt)) {
      tile.skipped++;
      tile.shareLimitedSkips++;
      tile.shedding = true;
      tile.debt -= tile.share;
      tile.debt = clampDebt(tile.debt);
      return {
        delivered: false,
        frame: tile.lastDeliveredFrame,
        debt: tile.debt,
      };
    }
    const { frame, costTicks } = attempt();
    tile.debt += costTicks - tile.share;
    tile.debt = clampDebt(tile.debt);
    tile.shedding = tile.debt > 0;
    onFrame(frame);
    tile.delivered++;
    tile.lastDeliveredFrame = frame;
    return { delivered: true, frame, debt: tile.debt };
  }
}

export const vizTileBudgetRegistry = new VizTileBudgetRegistry();

/** Hook for mosaic teardown / plugin sandbox unload. */
export function syncVizTileScope(activeTileIds: readonly string[]): void {
  vizTileBudgetRegistry.syncScope(activeTileIds);
}
