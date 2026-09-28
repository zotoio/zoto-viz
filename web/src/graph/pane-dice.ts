import { mosaicTileViewId } from "./mosaic-tile-id";

/**
 * A view to drop onto one mosaic pane. Skips the pane's current view.
 * When another tile already lays out the full device table, a lighter view is preferred.
 * A view that is not already on the wall is preferred when one exists.
 */
export function pickPaneDiceView(
  paneId: string,
  tileIds: readonly string[],
  candidates: readonly string[],
  isFullDevice: (viewId: string) => boolean,
  rnd: () => number = Math.random,
): string | null {
  const current = mosaicTileViewId(paneId);
  const others = candidates.filter((id) => id !== current);
  if (!others.length) return null;
  const wallHasOtherFull = tileIds.some((id) => id !== paneId && isFullDevice(mosaicTileViewId(id)));
  let pool = others;
  if (wallHasOtherFull) {
    const light = others.filter((id) => !isFullDevice(id));
    if (light.length) pool = light;
  }
  const placed = new Set(tileIds.map((id) => mosaicTileViewId(id)));
  const fresh = pool.filter((id) => !placed.has(id));
  if (fresh.length) pool = fresh;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rnd() * pool.length)));
  return pool[i] ?? null;
}
