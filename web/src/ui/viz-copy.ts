/** Viewer-facing viz HUD strings (shared with tile budget rows). */

/** #35-style status when a saved/URL wall has too many tiles (normal tone, not an error). */
export function mosaicWallLayoutRefusedMessage(requestedTiles: number, limit: number): string {
  return `Couldn't load this wall layout. It has ${requestedTiles} tiles and the limit is ${limit}, so your current wall is still showing.`;
}

/** Boot / profile reload when saved localStorage wall exceeds the tile cap (normal status tone). */
export function mosaicWallLayoutBootRefusedMessage(requestedTiles: number, limit: number): string {
  return `Couldn't load your saved wall layout. It has ${requestedTiles} tiles and the limit is ${limit}, so the default view is showing.`;
}

/** Dev-only dogfood URL flag rejected at wall build (normal status tone, not an error). */
export function devVizWallFlagBadInputMessage(param: "vizTileCostTicks", raw: string): string {
  return `Couldn't use ?${param}=${raw}; use a whole-wall decimal integer.`;
}

/** English ordinal for cadence k (11th–13th and 21st–23rd are not naive % 10). */
export function vizCadenceOrdinal(k: number): string {
  const n = Math.max(1, Math.floor(k));
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Wall LIMITED strip is shown only when {@link tileLimitedSharingLabelVisible}. */
export function tileLimitedSharingLabelVisible(activeTiles: number, cadenceK: number): boolean {
  return activeTiles >= 2 && cadenceK >= 2;
}

/** Copy for the wall LIMITED strip (N ≥ 2 and k ≥ 2; ordinal from {@link vizCadenceOrdinal}). */
export function tileLimitedSharingLabel(activeTiles: number, cadenceK: number): string {
  const n = Math.max(2, activeTiles);
  const ord = vizCadenceOrdinal(cadenceK);
  return `LIMITED · sharing the frame with ${n} tiles · updating every ${ord} frame`;
}

export const TILE_LIMITED_SHARING_TOOLTIP =
  "This pack needs more time per frame than its share of the wall. It runs at full rate on its own.";

export function formatHudSkipsPerSec(rate: number): string {
  if (rate < 0.05) return "0 skipped/s";
  const rounded = rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
  return `${rounded} skipped/s`;
}
