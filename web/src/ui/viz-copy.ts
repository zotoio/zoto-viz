/** Viewer-facing viz HUD strings (shared with tile budget rows). */

/** #35-style status when a saved/URL wall has too many tiles (normal tone, not an error). */
export function mosaicWallLayoutRefusedMessage(requestedTiles: number, limit: number): string {
  return `Couldn't load this wall layout. It has ${requestedTiles} tiles and the limit is ${limit}, so your current wall is still showing.`;
}

/** Boot / profile reload when saved localStorage wall exceeds the tile cap (normal status tone). */
export function mosaicWallLayoutBootRefusedMessage(requestedTiles: number, limit: number): string {
  return `Couldn't load your saved wall layout. It has ${requestedTiles} tiles and the limit is ${limit}, so the default view is showing.`;
}

export function tileLimitedSharingLabel(activeTiles: number, skipsPerSec: number): string {
  const n = Math.max(0, activeTiles);
  const rate = formatHudSkipsPerSec(skipsPerSec);
  return `LIMITED · sharing frame with ${n} tiles · ${rate}`;
}

export const TILE_LIMITED_SHARING_TOOLTIP =
  "This pack needs more time per frame than its share of the wall. It runs at full rate on its own.";

export function formatHudSkipsPerSec(rate: number): string {
  if (rate < 0.05) return "0 skipped/s";
  const rounded = rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
  return `${rounded} skipped/s`;
}
