/** One committed view id after reload — session snapshot wins over bare localStorage. */
export function resolveRestoredViewMode(args: {
  sessionMode?: string;
  localMode?: string | null;
  fallback: string;
}): string {
  const fromSession = args.sessionMode?.trim();
  if (fromSession) return fromSession;
  const fromLocal = args.localMode?.trim();
  if (fromLocal) return fromLocal;
  return args.fallback;
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
  if (!tiles.length || !mode.trim()) return tiles;
  if (tiles.includes(mode)) return tiles;
  const focus =
    focusHint && tiles.includes(focusHint) ? focusHint : tiles[0] ?? null;
  if (!focus) return tiles;
  const idx = tiles.indexOf(focus);
  if (idx < 0) return tiles;
  const next = tiles.slice();
  next[idx] = mode;
  return next;
}

