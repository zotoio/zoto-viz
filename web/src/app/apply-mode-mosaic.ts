import type { Mosaic } from "../graph/mosaic";

type MosaicFocusInput = Pick<Mosaic, "tileIds" | "focusedId"> & Partial<Pick<Mosaic, "mainTileId">>;

/** Focus slot for a header or settings view swap — must still be on the wall. */
export function mosaicFocusSlot(mosaic: MosaicFocusInput): string | null {
  const tiles = mosaic.tileIds;
  if (!tiles.length) return null;
  if (mosaic.focusedId && tiles.includes(mosaic.focusedId)) return mosaic.focusedId;
  const main = mosaic.mainTileId;
  if (main && tiles.includes(main)) return main;
  return tiles[0] ?? null;
}

/** Where to put `modeId` when it is not already on the wall. */
export function mosaicSwapFrom(
  mosaic: MosaicFocusInput,
  modeId: string,
): string | null {
  if (mosaic.tileIds.includes(modeId)) return null;
  return mosaicFocusSlot(mosaic);
}

export function revertModeSelection(
  prevMode: string,
  modeSel: { value: string },
  live: { mode: string },
  storageKey = "zoto-viz.mode",
): void {
  modeSel.value = prevMode || modeSel.value;
  live.mode = prevMode;
  localStorage.setItem(storageKey, modeSel.value);
}

export function consentBlockMessage(spec: { name?: string } | null | undefined): string {
  const where = "Approve it in Settings → Plugins.";
  if (spec?.name) return `${spec.name} isn't approved yet. ${where}`;
  return `Not approved yet. ${where}`;
}
