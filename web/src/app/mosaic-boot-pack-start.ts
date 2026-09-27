import { reconcileMosaicTilesWithMode, resolveRestoredViewMode } from "./boot-view-restore";

/** Boot: committed header mode vs persisted mosaic tiles before the first pack bind. */
export function bootMosaicPackStartLayout(
  tiles: string[],
  localMode: string | null | undefined,
  fallback: string,
  focusHint?: string | null,
): { mode: string; tiles: string[] } {
  const mode = resolveRestoredViewMode({ localMode, fallback });
  return {
    mode,
    tiles: reconcileMosaicTilesWithMode(tiles, mode, focusHint),
  };
}
