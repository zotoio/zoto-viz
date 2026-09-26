/** Viewer-facing viz HUD strings (shared with tile budget rows). */

export function tileLimitedSharingLabel(activeTiles: number, skipsPerSec: number): string {
  const mates = Math.max(0, activeTiles - 1);
  const rate = formatHudSkipsPerSec(skipsPerSec);
  return `LIMITED · sharing frame with ${mates} tiles · ${rate}`;
}

export const TILE_LIMITED_SHARING_TOOLTIP =
  "This pack needs more time per frame than its share of the wall. It runs at full rate on its own.";

export function formatHudSkipsPerSec(rate: number): string {
  if (rate < 0.05) return "0 skipped/s";
  const rounded = rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
  return `${rounded} skipped/s`;
}
