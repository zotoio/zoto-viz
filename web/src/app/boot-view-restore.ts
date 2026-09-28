import { remapSavedViewId } from "../core/saved-view-id";

/** One committed view id after reload — session snapshot wins over bare localStorage. */
export function resolveRestoredViewMode(args: {
  sessionMode?: string;
  localMode?: string | null;
  fallback: string;
}): string {
  const fromSession = args.sessionMode?.trim();
  if (fromSession) return remapSavedViewId(fromSession);
  const fromLocal = args.localMode?.trim();
  if (fromLocal) return remapSavedViewId(fromLocal);
  return remapSavedViewId(args.fallback);
}

/**
 * After a header-driven view change, `zoto-viz.mode` can disagree with persisted
 * `mosaicTiles` until layout is saved. On reload, prefer the committed mode on
 * the focused slot (or the first slot when focus is unknown).
 */
export function reconcileMosaicTilesWithMode(
  tiles: string[],
  mode: string,
  focusHint?: string | null,
): string[] {
  const mappedMode = remapSavedViewId(mode);
  const mappedTiles = tiles.map((t) => remapSavedViewId(t));
  if (!mappedTiles.length || !mappedMode.trim()) return mappedTiles;
  if (mappedTiles.includes(mappedMode)) return mappedTiles;
  const focus =
    focusHint && mappedTiles.includes(remapSavedViewId(focusHint))
      ? remapSavedViewId(focusHint)
      : mappedTiles[0] ?? null;
  if (!focus) return mappedTiles;
  const idx = mappedTiles.indexOf(focus);
  if (idx < 0) return mappedTiles;
  const next = mappedTiles.slice();
  next[idx] = mappedMode;
  return next;
}

/** Header selector, main graph mode, and mounted plugin id should agree. */
export function viewMountState(args: {
  headerModeId: string;
  sceneModeId: string;
  pluginActiveId: string | null;
}): boolean {
  if (args.headerModeId !== args.sceneModeId) return false;
  const pluginId = args.headerModeId.startsWith("plugin:")
    ? args.headerModeId.slice("plugin:".length)
    : null;
  if (pluginId && args.pluginActiveId && args.pluginActiveId !== pluginId) return false;
  return true;
}
