import type { VizTileBudgetStats } from "../plugins/viz-tile-budget";

export interface VizHudTileBudgetLine {
  tileId: string;
  tile: VizTileBudgetStats;
}

const scratch: VizHudTileBudgetLine[] = [];
let pairObjectsCreated = 0;

/** Count of `{ tileId, tile }` pair objects allocated (F4 steady gate). */
export function vizHudTileBudgetLineObjectsCreated(): number {
  return pairObjectsCreated;
}

export function resetVizHudTileBudgetLineAllocCounter(): void {
  pairObjectsCreated = 0;
}

/**
 * Reused scratch for mosaic HUD tile lines (main present loop).
 * Grows the scratch pool only when tile count increases; updates ids in place.
 */
export function mosaicTileBudgetLines(tileIds: readonly string[]): VizHudTileBudgetLine[] | undefined {
  if (!tileIds.length) return undefined;
  while (scratch.length < tileIds.length) {
    scratch.push({ tileId: "", tile: null as unknown as VizTileBudgetStats });
    pairObjectsCreated++;
  }
  for (let i = 0; i < tileIds.length; i++) {
    const row = scratch[i]!;
    row.tileId = tileIds[i]!;
  }
  scratch.length = tileIds.length;
  return scratch;
}

/** Assign tile stats after registry lookup (call once per frame after mosaicTileBudgetLines). */
export function bindMosaicTileBudgetLines(
  lines: VizHudTileBudgetLine[],
  getTile: (id: string) => VizTileBudgetStats,
): void {
  for (const row of lines) row.tile = getTile(row.tileId);
}
