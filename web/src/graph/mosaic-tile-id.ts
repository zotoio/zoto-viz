/** Mosaic leaf ids may repeat the same pack view; `!n` suffixes disambiguate tile slots. */
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
export function allocateMosaicTileSlot(viewId: string, existing: readonly string[]): string {
  const others = existing.filter((id) => mosaicTileViewId(id) === viewId);
  if (!others.length) return viewId;
  let n = 1;
  while (existing.includes(mosaicTileSlotId(viewId, n))) n += 1;
  return mosaicTileSlotId(viewId, n);
}
