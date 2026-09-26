import type { VizDataFrame } from "./viz-host";
import {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_4MS,
  VIZ_COST_TICKS_10MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  VIZ_COST_SPIKE_500MS,
  VIZ_DEBT_CAP_TICKS,
  VIZ_HUD_WINDOW_TICKS,
  VIZ_MAX_ACTIVE_TILES,
  VIZ_TICKS_PER_MS,
  VIZ_WALL_BUDGET_TICKS,
} from "./viz-tile-constants";

export {
  VIZ_CLOCK_STEP_TICKS,
  VIZ_COST_TICKS_4MS,
  VIZ_COST_TICKS_10MS,
  VIZ_COST_TICKS_20MS,
  VIZ_COST_TICKS_50MS,
  VIZ_COST_SPIKE_500MS,
  VIZ_DEBT_CAP_TICKS,
  VIZ_HUD_WINDOW_TICKS,
  VIZ_MAX_ACTIVE_TILES,
  VIZ_TICKS_PER_MS,
  VIZ_WALL_BUDGET_TICKS,
};

export type VizTileHudSampleKind = "skip" | "build";

export interface VizTileHudSample {
  tick: number;
  kind: VizTileHudSampleKind;
  costTicks?: number;
}

/** Max HUD window samples retained per tile (ring; no per-frame push allocation). */
export const VIZ_HUD_SAMPLE_CAP = 3600;

export function msToVizTicks(ms: number): number {
  return Math.round(ms * VIZ_TICKS_PER_MS);
}

/**
 * Per-tile share of the 16.7 ms wall budget.
 * Real layouts: 1×1→5010, 2×2→1252, 2×3→835, 2×4→626 (floor(5010/n)).
 * Active tile count is clamped to {@link VIZ_MAX_ACTIVE_TILES} before dividing.
 */
export function tileShareTicks(activeTiles: number): number {
  const n = Math.min(VIZ_MAX_ACTIVE_TILES, Math.max(1, activeTiles));
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
  lastBuildCostTicks: number | null;
  /** Ring buffer of HUD samples (half-open tick window (now − 300000, now]). */
  hudRing: VizTileHudSample[];
  hudRingCount: number;
  hudRingNext: number;
}

function makeHudRing(): VizTileHudSample[] {
  const ring = new Array<VizTileHudSample>(VIZ_HUD_SAMPLE_CAP);
  for (let i = 0; i < VIZ_HUD_SAMPLE_CAP; i++) {
    ring[i] = { tick: 0, kind: "skip" };
  }
  return ring;
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
    lastBuildCostTicks: null,
    hudRing: makeHudRing(),
    hudRingCount: 0,
    hudRingNext: 0,
  };
}

/** Count skip samples in the HUD window by walking the ring (no `.filter` allocation). */
export function tileSkipsInHudWindowRing(
  tile: VizTileBudgetStats,
  nowTick: number,
  inclusiveLower = false,
): number {
  const lo = nowTick - VIZ_HUD_WINDOW_TICKS;
  const n = tile.hudRingCount;
  if (n === 0) return 0;
  const cap = VIZ_HUD_SAMPLE_CAP;
  const start = (tile.hudRingNext - n + cap) % cap;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const s = tile.hudRing[(start + i) % cap]!;
    const inWin = inclusiveLower
      ? s.tick >= lo && s.tick <= nowTick
      : s.tick > lo && s.tick <= nowTick;
    if (inWin && s.kind === "skip") count++;
  }
  return count;
}

/** Materialize ring samples in chronological order (tests / HUD classification). */
export function hudSamplesForTile(tile: VizTileBudgetStats): VizTileHudSample[] {
  const n = tile.hudRingCount;
  if (n === 0) return [];
  const out = new Array<VizTileHudSample>(n);
  const cap = VIZ_HUD_SAMPLE_CAP;
  const start = (tile.hudRingNext - n + cap) % cap;
  for (let i = 0; i < n; i++) {
    out[i] = tile.hudRing[(start + i) % cap]!;
  }
  return out;
}

function clampDebt(debt: number): number {
  let d = debt;
  if (d < 0) d = 0;
  if (d > VIZ_DEBT_CAP_TICKS) d = VIZ_DEBT_CAP_TICKS;
  return d;
}

function recordHudSample(tile: VizTileBudgetStats, sample: VizTileHudSample): void {
  const slot = tile.hudRing[tile.hudRingNext]!;
  slot.tick = sample.tick;
  slot.kind = sample.kind;
  if (sample.costTicks !== undefined) slot.costTicks = sample.costTicks;
  else delete slot.costTicks;
  tile.hudRingNext = (tile.hudRingNext + 1) % VIZ_HUD_SAMPLE_CAP;
  if (tile.hudRingCount < VIZ_HUD_SAMPLE_CAP) tile.hudRingCount++;
}

function clearHudWindow(tile: VizTileBudgetStats): void {
  tile.hudRingCount = 0;
  tile.hudRingNext = 0;
}

/**
 * Per-tile frame debt ledger. Share is keyed by tile id and recomputed only in
 * {@link syncVizTileScope} (mosaic / sandbox teardown), which zeroes debt when share changes.
 */
export class VizTileBudgetRegistry {
  private readonly tiles = new Map<string, VizTileBudgetStats>();
  private activeTiles = 1;
  private nowTick = 0;
  private clampActiveTiles = true;

  getTile(tileId: string): VizTileBudgetStats {
    const share = Math.floor(VIZ_WALL_BUDGET_TICKS / this.activeTiles);
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

  /** Simulated / host tick for HUD windows (defaults to 0 until advanced). */
  currentTick(): number {
    return this.nowTick;
  }

  setCurrentTick(tick: number): void {
    this.nowTick = tick;
  }

  advanceTick(deltaTicks = VIZ_CLOCK_STEP_TICKS): void {
    this.nowTick += deltaTicks;
  }

  /**
   * Scope sync after sandbox teardown / mosaic tile set change.
   * Recomputes share, zeroes debt, and clears the HUD window when share changes.
   */
  syncScope(activeTileIds: readonly string[]): void {
    const n = Math.min(VIZ_MAX_ACTIVE_TILES, Math.max(1, activeTileIds.length));
    this.applyScope(n, activeTileIds, true);
  }

  /**
   * Direct scheduler scope (dogfood H5): share from raw tile count without the 8-tile clamp.
   */
  syncScopeScheduler(tileCount: number, activeTileIds: readonly string[]): void {
    const n = Math.max(1, tileCount);
    this.applyScope(n, activeTileIds, false);
  }

  private applyScope(n: number, activeTileIds: readonly string[], clampTileCount: boolean): void {
    const counted = clampTileCount ? Math.min(VIZ_MAX_ACTIVE_TILES, Math.max(1, n)) : Math.max(1, n);
    const effectiveShare = Math.floor(VIZ_WALL_BUDGET_TICKS / counted);
    this.activeTiles = counted;
    this.clampActiveTiles = clampTileCount;
    const keep = new Set(activeTileIds);
    for (const id of keep) {
      let t = this.tiles.get(id);
      if (!t) {
        t = freshTile(effectiveShare);
        this.tiles.set(id, t);
        vizTileBudgetLifecycle.created++;
      } else if (t.share !== effectiveShare) {
        t.share = effectiveShare;
        t.debt = 0;
        clearHudWindow(t);
      }
    }
    for (const id of [...this.tiles.keys()]) {
      if (!keep.has(id)) {
        this.tiles.delete(id);
        vizTileBudgetLifecycle.released++;
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
    this.nowTick = 0;
    this.clampActiveTiles = true;
    resetVizTileBudgetLifecycle();
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
    opts?: { tick?: number },
  ): { delivered: boolean; frame: VizDataFrame | null; debt: number } {
    const tick = opts?.tick ?? this.nowTick;
    const tile = this.getTile(tileId);
    if (!debtIsClear(tile.debt)) {
      tile.skipped++;
      tile.shareLimitedSkips++;
      tile.shedding = true;
      tile.debt -= tile.share;
      tile.debt = clampDebt(tile.debt);
      recordHudSample(tile, { tick, kind: "skip" });
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
    tile.lastBuildCostTicks = costTicks;
    recordHudSample(tile, { tick, kind: "build", costTicks });
    return { delivered: true, frame, debt: tile.debt };
  }
}

export const vizTileBudgetRegistry = new VizTileBudgetRegistry();

export const vizTileBudgetLifecycle = { created: 0, released: 0 };

export function resetVizTileBudgetLifecycle(): void {
  vizTileBudgetLifecycle.created = 0;
  vizTileBudgetLifecycle.released = 0;
}

/** Hook for mosaic teardown / plugin sandbox unload. */
export function syncVizTileScope(activeTileIds: readonly string[]): void {
  vizTileBudgetRegistry.syncScope(activeTileIds);
}

export function syncVizTileSchedulerScope(tileCount: number, activeTileIds: readonly string[]): void {
  vizTileBudgetRegistry.syncScopeScheduler(tileCount, activeTileIds);
}
