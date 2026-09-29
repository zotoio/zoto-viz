/**
 * Needs you: a view that waits on the operator's OK shows it on its own tile (name, one sentence,
 * Review), never a modal and never the previous view. Review opens the source review inside the
 * tile notice; the answer goes to whoever is waiting for this pack (a pick in flight), or, when the
 * pick has already settled, it is kept and the tile's `restart` starts the view in place.
 * "Not now" folds the review back to the notice and the tile stays on Needs you.
 */

import type { PluginView } from "../plugins/plugin";
import { renderPackReview, type PackReviewChoice } from "../plugins/plugin-ui";
import { consentGranted, consentKindOf, consentStateOf, onConsentChange, type ConsentKind } from "./consent-store";
import { needsYouReasonFor, showViewState, viewStateOf, viewStateTileEl } from "./view-state";

type Waiter = (kind: ConsentKind | null) => void;

/** Tests answer the review directly instead of pressing Review on the tile. */
export type TileReviewRunner = (
  spec: PluginView,
  opts: { signal: AbortSignal; state: ReturnType<typeof consentStateOf> },
) => Promise<PackReviewChoice>;

const waiters = new Map<string, Set<Waiter>>();
/** An OK given on a settled tile, taken by the restart's review wait. */
const answered = new Map<string, ConsentKind>();

function grantedKind(spec: PluginView): ConsentKind | null {
  return consentGranted(spec) ? (consentKindOf(spec.id) ?? "reviewed") : null;
}

/**
 * Wait for the operator's answer for this pack: a Review on any tile showing it, an OK kept from a
 * settled tile, or a grant made elsewhere (Settings, live patch). Aborting resolves `null`.
 */
export function waitForTileReview(spec: PluginView, signal: AbortSignal): Promise<ConsentKind | null> {
  const kept = answered.get(spec.id);
  if (kept) {
    answered.delete(spec.id);
    return Promise.resolve(kept);
  }
  const already = grantedKind(spec);
  if (already) return Promise.resolve(already);
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let set = waiters.get(spec.id);
    if (!set) {
      set = new Set();
      waiters.set(spec.id, set);
    }
    const own = set;
    let off = () => {};
    const done: Waiter = (kind) => {
      own.delete(done);
      if (!own.size && waiters.get(spec.id) === own) waiters.delete(spec.id);
      signal.removeEventListener("abort", onAbort);
      off();
      resolve(kind);
    };
    const onAbort = () => done(null);
    signal.addEventListener("abort", onAbort, { once: true });
    off = onConsentChange((packId) => {
      if (packId !== spec.id) return;
      const kind = grantedKind(spec);
      if (kind) done(kind);
    });
    own.add(done);
  });
}

/** An OK given on a settled tile is waiting for the restart to take it. */
export function hasKeptTileAnswer(packId: string): boolean {
  return answered.has(packId);
}

export function hasTileReviewWaiter(packId: string): boolean {
  return (waiters.get(packId)?.size ?? 0) > 0;
}

/** Hand the answer to the waiting pick. False when nobody waits (the tile's pick has settled). */
export function answerTileReview(packId: string, kind: ConsentKind): boolean {
  const set = waiters.get(packId);
  if (!set?.size) return false;
  for (const w of [...set]) w(kind);
  return true;
}

export type NeedsYouTile = {
  tileId: string;
  viewId: string;
  spec: PluginView;
  /** Start the view in place after an OK given when no pick is waiting (no reload). */
  restart?: () => void;
  /** Element when the host resolver cannot find the tile (tests, detached panes). */
  hostEl?: HTMLElement | null;
};

/** Paint Needs you on the tile: "<View> needs your OK to run." and Review. */
export function showNeedsYou(tile: NeedsYouTile): void {
  const { spec } = tile;
  showViewState(
    tile.tileId,
    tile.viewId,
    spec.name || spec.id,
    { kind: "needs-you", reason: needsYouReasonFor(consentStateOf(spec)), packId: spec.id },
    { onReview: () => openTileReview(tile), onActionFocused: () => focusReview(tile) },
    tile.hostEl,
  );
}

function tileNotice(tile: NeedsYouTile): HTMLElement | null {
  const el = viewStateTileEl(tile.tileId) ?? tile.hostEl ?? null;
  return el?.querySelector<HTMLElement>(":scope > .mosaic-pane-notice") ?? null;
}

function focusReview(tile: NeedsYouTile): void {
  tileNotice(tile)?.querySelector<HTMLButtonElement>(".pack-review-cancel")?.focus();
}

/** Review: the source review opens inside the tile's notice. */
export function openTileReview(tile: NeedsYouTile): void {
  const notice = tileNotice(tile);
  if (!notice) return;
  const { spec } = tile;
  notice.querySelector<HTMLElement>(":scope > .mosaic-pane-notice-retry")?.setAttribute("hidden", "");
  renderPackReview(notice, spec, {
    state: consentStateOf(spec),
    onChoice: (kind: PackReviewChoice) => {
      if (!kind) {
        // Not now: back to the notice, still Needs you (never the previous view).
        showNeedsYou(tile);
        tileNotice(tile)?.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry")?.focus();
        return;
      }
      if (answerTileReview(spec.id, kind)) return;
      answered.set(spec.id, kind);
      tile.restart?.();
    },
  });
}

/** Still showing Needs you for this pack (not taken over by another state or view). */
export function tileNeedsYou(tileId: string, packId: string): boolean {
  const vs = viewStateOf(tileId);
  return vs?.kind === "needs-you" && vs.packId === packId;
}

export function resetNeedsYouForTests(): void {
  for (const set of waiters.values()) for (const w of [...set]) w(null);
  waiters.clear();
  answered.clear();
}
