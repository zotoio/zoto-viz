import { mosaicTileViewId, parseMosaicSlotId } from "../graph/mosaic-tile-id";

/** First mosaic leaf id for `packId` in wall reading order (left→right, top→bottom). */
export function firstPackTileInReadingOrder(tileIds: readonly string[], packId: string): string | null {
  for (const id of tileIds) {
    const parsed = parseMosaicSlotId(id);
    if (parsed.packId === packId) return id;
  }
  return null;
}

export function countPackTiles(tileIds: readonly string[], packId: string): number {
  let n = 0;
  for (const id of tileIds) {
    if (parseMosaicSlotId(id).packId === packId) n += 1;
  }
  return n;
}

export function tileSlotOnWall(tileSlotId: string, tileIds: readonly string[]): boolean {
  return tileIds.includes(tileSlotId);
}

export function packIdForModeId(modeId: string): string | null {
  return parseMosaicSlotId(modeId).packId;
}

export function samePackView(modeA: string, modeB: string): boolean {
  return mosaicTileViewId(modeA) === mosaicTileViewId(modeB)
    && packIdForModeId(modeA) === packIdForModeId(modeB);
}
