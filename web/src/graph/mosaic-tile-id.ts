/** Legacy: saved leaf ids may carry `!n` slot suffixes. They are read (stripped) but never minted; a view is on at most one pane. */
const SLOT_MARK = "!";

export function mosaicTileViewId(tileSlotId: string): string {
  const i = tileSlotId.lastIndexOf(SLOT_MARK);
  if (i < 0) return tileSlotId;
  const tail = tileSlotId.slice(i + 1);
  if (/^\d+$/.test(tail)) return tileSlotId.slice(0, i);
  return tileSlotId;
}

export function mosaicTileSlotSuffix(tileSlotId: string): number | null {
  const i = tileSlotId.lastIndexOf(SLOT_MARK);
  if (i < 0) return null;
  const tail = tileSlotId.slice(i + 1);
  if (!/^\d+$/.test(tail)) return null;
  return Number(tail);
}

export function mosaicTileSlotId(viewId: string, slot: number): string {
  return `${viewId}${SLOT_MARK}${slot}`;
}

export type ParsedMosaicSlotId = {
  /** Plugin pack id (no `plugin:` prefix); null for non-plugin leaves. */
  packId: string | null;
  /** Numeric tile slot when the leaf id ends with `!n`; null for the primary unsuffixed tile. */
  slot: number | null;
  /** Catalog view id with any numeric `!n` suffix stripped. */
  viewId: string;
};

/** Single host entry point for a raw mosaic leaf / mode id (including `plugin:pack!n`). */
export function parseMosaicSlotId(raw: string): ParsedMosaicSlotId {
  const viewId = mosaicTileViewId(raw);
  const slot = mosaicTileSlotSuffix(raw);
  let packId: string | null = null;
  if (viewId.startsWith("plugin:")) {
    const rest = viewId.slice("plugin:".length);
    packId = rest.split(":")[0] || null;
  }
  return { packId, slot, viewId };
}

/** Tile indices (1-based) where a view id appears on the wall. */
export function mosaicPlacedTileIndices(tileSlotIds: readonly string[], viewId?: string): number[] {
  const want = viewId ?? "";
  const out: number[] = [];
  for (let i = 0; i < tileSlotIds.length; i++) {
    if (mosaicTileViewId(tileSlotIds[i]!) === want) out.push(i + 1);
  }
  return out;
}

export function mosaicWallUsesView(tileSlotIds: readonly string[], viewId: string): boolean {
  return tileSlotIds.some((id) => mosaicTileViewId(id) === viewId);
}

/** Pick a unique leaf id for another tile of the same pack view. */
/** Views are unique per wall now: never mints a `!n` copy, always the canonical view id. */
export function allocateMosaicTileSlot(viewId: string, _existing?: readonly string[]): string {
  return mosaicTileViewId(viewId);
}

/** Stable identity for an open view drawer (pack + catalog view, not tile slot position). */
export type DrawerKey = string & { readonly __drawerKeyBrand: unique symbol };

/** Single entry point: drawer ownership is keyed by view + pack, never by mosaic tile index. */
function drawerKeyFor(viewId: string, packId: string | null): DrawerKey {
  const view = mosaicTileViewId(viewId);
  const pack = packId?.trim() ?? "";
  return `${view}\0${pack}` as DrawerKey;
}

export function drawerKeyForModeId(modeId: string): DrawerKey {
  const parsed = parseMosaicSlotId(modeId);
  return drawerKeyFor(parsed.viewId, parsed.packId);
}

/**
 * One view per pane, always: strip `!n` slot suffixes and replace any repeated view (in place, so
 * pane positions hold) with the first `pool` view not already on the wall. A repeat with no unused
 * view left comes back as null so the caller closes that pane instead of showing the view twice.
 */
export function uniqueMosaicViews(ids: readonly string[], pool: readonly string[] = []): (string | null)[] {
  const views = ids.map((id) => mosaicTileViewId(id));
  const used = new Set<string>();
  const taken = (v: string) => mosaicViewKeys(v).some((k) => used.has(k));
  const take = (v: string) => { for (const k of mosaicViewKeys(v)) used.add(k); };
  const out: (string | null)[] = views.map((v) => {
    if (!v || taken(v)) return null;
    take(v);
    return v;
  });
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    const fill = pool.map((v) => mosaicTileViewId(v)).find((v) => !!v && !taken(v));
    if (fill) {
      take(fill);
      out[i] = fill;
    }
  }
  return out;
}

/**
 * Identity keys for one view: the `!n`-free id plus whatever the catalog registers (pack +
 * instance, caption). Two ids sharing any key are the same view for uniqueness.
 */
let viewKeys: (viewId: string) => readonly string[] = () => [];
export function setMosaicViewKeys(fn: (viewId: string) => readonly string[]): void {
  viewKeys = fn;
}
export function mosaicViewKeys(id: string): string[] {
  const v = mosaicTileViewId(id);
  let extra: readonly string[] = [];
  try { extra = viewKeys(v); } catch { extra = []; }
  return [`id:${v}`, ...extra.filter(Boolean)];
}

/** True when no view (suffix-normalised) shows on more than one pane. */
export function mosaicViewsUnique(ids: readonly string[]): boolean {
  return uniqueMosaicViews(ids).every((v, i) => v !== null && v === mosaicTileViewId(ids[i]!));
}
