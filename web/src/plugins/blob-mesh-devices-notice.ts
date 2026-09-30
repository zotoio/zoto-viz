/**
 * Blob Mesh over-budget notice (#173). When the minimum blob sizes alone don't fit the coverage
 * budget (plugins/sdk/blob-mesh-budget.ts), the writer draws only the busiest devices that fit
 * (#173 option b) and the tile says so in an info caption: normal tone, no Retry, no error
 * colour, small and out of the way so it never covers the blobs. User-facing word: "devices".
 */

/** Over budget this long before the caption shows. */
export const BLOB_MESH_NOTICE_SHOW_MS = 3000;
/** Back under budget this long before it hides (a LAN hovering at the edge must not flicker it). */
export const BLOB_MESH_NOTICE_HIDE_MS = 3000;

/**
 * UX Pro copy (#173): N shown, M hidden. "quieter" only when every hidden device is strictly
 * quieter than the quietest shown; with a tie at the cut (a hidden device as busy as the smallest
 * shown) it says "more" instead.
 */
export function blobMeshDevicesNoticeText(shown: number, hidden: number, tieAtCut = false): string | null {
  if (hidden <= 0) return null;
  const rest = tieAtCut
    ? (hidden === 1 ? "1 more doesn't fit." : `${hidden} more don't fit.`) // tie copy
    : (hidden === 1 ? "1 quieter one doesn't fit." : `${hidden} quieter ones don't fit.`);
  return `Showing the ${shown} busiest devices. ${rest}`;
}

/** Show after SHOW_MS continuously over budget; hide after HIDE_MS continuously under. */
export class BlobMeshDevicesNoticeLatch {
  private overSince: number | null = null;
  private underSince: number | null = null;
  private visible = false;
  private text: string | null = null;

  update(shown: number, hidden: number, nowMs: number, tieAtCut = false): string | null {
    const next = blobMeshDevicesNoticeText(shown, hidden, tieAtCut);
    if (next) {
      this.underSince = null;
      this.overSince ??= nowMs;
      this.text = next;
      if (!this.visible && nowMs - this.overSince >= BLOB_MESH_NOTICE_SHOW_MS) this.visible = true;
    } else {
      this.overSince = null;
      this.underSince ??= nowMs;
      if (this.visible && nowMs - this.underSince >= BLOB_MESH_NOTICE_HIDE_MS) this.visible = false;
    }
    return this.visible ? this.text : null;
  }
}

const latches = new Map<string, BlobMeshDevicesNoticeLatch>();

export function blobMeshNoticeLatchFor(tileKey: string): BlobMeshDevicesNoticeLatch {
  let latch = latches.get(tileKey);
  if (!latch) {
    latch = new BlobMeshDevicesNoticeLatch();
    latches.set(tileKey, latch);
  }
  return latch;
}

export function resetBlobMeshNoticeLatches(): void {
  latches.clear();
}

export const PACK_INFO_CAPTION_CLASS = "pack-info-caption";

/**
 * Paint (or clear, with null) the tile's info caption: a small top-edge pill, click-through,
 * separate from the full-tile `.mosaic-pane-notice` layer so it never hides the view or another
 * notice. Idempotent and cheap (no DOM query); safe to call every frame.
 */
const captions = new WeakMap<HTMLElement, HTMLElement>();

export function paintPackInfoCaption(tileEl: HTMLElement | null | undefined, text: string | null): void {
  if (!tileEl) return;
  const existing = captions.get(tileEl);
  if (!text) {
    if (existing) {
      existing.remove();
      captions.delete(tileEl);
    }
    return;
  }
  if (existing && existing.parentElement === tileEl) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  const el = document.createElement("div");
  el.className = PACK_INFO_CAPTION_CLASS;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.textContent = text;
  tileEl.appendChild(el);
  captions.set(tileEl, el);
}
