import type { Mosaic } from "../graph/mosaic";

/** Focus slot for a header or settings view swap — must still be on the wall. */
export function mosaicFocusSlot(mosaic: Pick<Mosaic, "tileIds" | "focusedId">): string | null {
  const tiles = mosaic.tileIds;
  if (!tiles.length) return null;
  if (mosaic.focusedId && tiles.includes(mosaic.focusedId)) return mosaic.focusedId;
  return tiles[0] ?? null;
}

/** Where to put `modeId` when it is not already on the wall. */
export function mosaicSwapFrom(
  mosaic: Pick<Mosaic, "tileIds" | "focusedId">,
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
  if (spec?.name) return `${spec.name} needs review before it can run — open This view or enable auto-consent.`;
  return "This plugin needs review before it can run — open This view or enable auto-consent.";
}

type MosaicSwapHost = Pick<Mosaic, "tileIds" | "focusedId" | "setPaneView" | "setPaneNotice">;

export type MosaicPreApplyResult = "ok" | "denied" | "no-target" | "swap-failed";

/** Header mode dropdown: consent and pane swap before any wall chrome side effects. */
export async function mosaicHeaderPreApply(
  mosaic: MosaicSwapHost,
  modeId: string,
  ensureReviewed: () => Promise<boolean>,
  spec: { name?: string } | null | undefined,
): Promise<MosaicPreApplyResult> {
  const swapFrom = mosaicSwapFrom(mosaic, modeId);
  if (!mosaic.tileIds.includes(modeId) && !swapFrom) return "no-target";
  if (!(await ensureReviewed())) {
    const noticeSlot = swapFrom ?? mosaicFocusSlot(mosaic);
    if (noticeSlot) mosaic.setPaneNotice(noticeSlot, consentBlockMessage(spec));
    return "denied";
  }
  if (swapFrom && !mosaic.setPaneView(swapFrom, modeId)) return "swap-failed";
  mosaic.setPaneNotice(modeId, null);
  return "ok";
}

/** Settings mosaic slot picker: consent before pane swap. */
export async function mosaicPanePickPreApply(
  mosaic: MosaicSwapHost,
  from: string,
  to: string,
  ensureReviewed: () => Promise<boolean>,
  spec: { name?: string } | null | undefined,
): Promise<MosaicPreApplyResult> {
  const slot = mosaic.tileIds.includes(from) ? from : mosaicFocusSlot(mosaic);
  if (!slot) return "no-target";
  if (!(await ensureReviewed())) {
    mosaic.setPaneNotice(slot, consentBlockMessage(spec));
    return "denied";
  }
  if (!mosaic.setPaneView(slot, to)) return "swap-failed";
  mosaic.setPaneNotice(to, null);
  return "ok";
}
