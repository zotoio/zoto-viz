import { reconcileMosaicTilesWithMode } from "./boot-view-restore";

/** Reload / settings animation: align persisted mosaic tiles with header mode before applyMode. */
export function mosaicReloadLayoutTiles(
  tiles: string[],
  mode: string,
  focusHint?: string | null,
): string[] {
  return reconcileMosaicTilesWithMode(tiles, mode, focusHint);
}
