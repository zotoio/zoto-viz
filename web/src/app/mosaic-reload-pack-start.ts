import { reconcileMosaicTilesWithMode } from "./boot-view-restore";

/** Reload / layout restore: align mosaic tile ids with the persisted header mode. */
export function reloadMosaicTilesForMode(
  tiles: string[],
  mode: string,
  focusHint?: string | null,
): string[] {
  return reconcileMosaicTilesWithMode(tiles, mode, focusHint);
}
