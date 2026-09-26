/** Mosaic leaf ids may repeat the same pack view; `!n` suffixes disambiguate tile slots. */
const SLOT_MARK = "!";

export function mosaicTileViewId(tileSlotId: string): string {
  const i = tileSlotId.lastIndexOf(SLOT_MARK);
  if (i < 0) return tileSlotId;
  const tail = tileSlotId.slice(i + 1);
  if (/^\d+$/.test(tail)) return tileSlotId.slice(0, i);
  return tileSlotId;
}
