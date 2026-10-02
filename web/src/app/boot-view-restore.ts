import { remapSavedViewId } from "../core/saved-view-id";
import { parsePluginId } from "../plugins/instances";

/** Per-tile overrides carried beside mosaic tile ids. */
export type TileOverride = {
  look?: Record<string, string | number | boolean>;
  config?: Record<string, string>;
  /** `render.scale.min` floor. Kept across a pack swap. */
  floor?: number;
};

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
function packOf(id: string): string {
  return parsePluginId(id) ?? id;
}

/** Move overrides onto rewritten ids. A pack swap drops pack config and keeps look and the render floor. */
export function relocateTileOverrides(
  before: readonly string[],
  after: readonly string[],
  bag: Record<string, TileOverride>,
): Record<string, TileOverride> {
  const next: Record<string, TileOverride> = { ...bag };
  // An alias rewrite (`plugin:cpu-pong` → `plugin:cpupong`) keeps every override.
  const aliased = before.map((id) => {
    const mapped = remapSavedViewId(id);
    if (mapped !== id && next[id]) {
      next[mapped] = next[id]!;
      delete next[id];
    }
    return mapped;
  });
  const moved = new Set<string>();
  const n = Math.max(aliased.length, after.length);
  for (let i = 0; i < n; i++) {
    const from = aliased[i];
    const to = after[i];
    if (!from || from === to) continue;
    const ov = next[from];
    moved.add(from);
    if (!ov || !to) {
      delete next[from];
      continue;
    }
    next[to] = packOf(from) === packOf(to) ? ov : { look: ov.look, floor: ov.floor };
    delete next[from];
  }
  for (const id of aliased) {
    if (!after.includes(id) && !moved.has(id)) delete next[id];
  }
  return next;
}

export function reconcileMosaicTilesWithMode(
  tiles: string[],
  mode: string,
  focusHint?: string | null,
  tileOverrides?: Record<string, TileOverride>,
): string[] {
  const mappedMode = remapSavedViewId(mode);
  const mappedTiles = tiles.map((t) => remapSavedViewId(t));
  let next = mappedTiles;
  if (mappedTiles.length && mappedMode.trim() && !mappedTiles.includes(mappedMode)) {
    const focus =
      focusHint && mappedTiles.includes(remapSavedViewId(focusHint))
        ? remapSavedViewId(focusHint)
        : mappedTiles[0] ?? null;
    if (focus) {
      const idx = mappedTiles.indexOf(focus);
      if (idx >= 0) {
        next = mappedTiles.slice();
        next[idx] = mappedMode;
      }
    }
  }
  if (tileOverrides) {
    const relocated = relocateTileOverrides(tiles, next, tileOverrides);
    for (const key of Object.keys(tileOverrides)) delete tileOverrides[key];
    Object.assign(tileOverrides, relocated);
  }
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
