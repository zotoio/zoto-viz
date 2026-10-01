/**
 * The per-tile "couldn't draw" surface (#179 c), painted from each tile's view state.
 *
 * Only `cant-draw` / `shader` is painted per tile: one tile's shader failed, the others still draw.
 * A lost context stops every tile at once, so it is never painted per tile (a screen reader would
 * read it once per tile): the wall notice (`GfxWallNotice`, one `role="status"` region) says it
 * once, and owns the only Reload button, shown exactly when the tiles' state carries `reload: true`
 * (UX Pro, #179 c).
 *
 * When the host's tile-shader latch has also mounted its fallback (`.tile-shader-fallback`), the tile
 * still carries one message: a pack's own simple view (the fallback's "Simple view" chip) is left as
 * it is; otherwise the latch's generic line ("can't run its graphics on this device", which is
 * capability copy) is hidden (style.css: `[data-cant-draw-surface] > .tile-shader-fallback`) and this
 * surface's own "couldn't draw" line shows. The surface never writes into the latch's element, so the
 * latch's 5 s fallback tick (refreshShaderFallbackText) can't overwrite the sentence.
 * The shader copy offers no button ("Pick another view, or reload to try again": both live elsewhere).
 * While the line shows, the tile's floating graph labels (`.label`) are hidden: the tile carries
 * `data-cant-draw-surface`, and style.css hides `.label` under it (only that tile's labels).
 * The name goes through `sanitizePackDisplayName` (empty: viewStateCopy says "This view") and reaches
 * the DOM as textContent only.
 * Where it lands comes from TSE's `viewStateTile(tileId, el)`: "main" is the solo wall (1 tile), a
 * mosaic pane counts the panes on its wall, so a solo tile drops "Other tiles aren't affected".
 *
 * One exception to "never per tile" (#216): a tile whose view is a pack with its own frontend
 * (`CantDrawPackTiles.isPack`) also paints `cant-draw` / `context-lost`, "<Pack> couldn't draw."
 * with Retry. Its board is the pack's own drawing, so without the line it is silently blank. The
 * line replaces the tile's sky-starting card (a Starting card under a lost context would never
 * land), and Retry asks the host for the context back (`retry`), never a new sky wait. When the
 * context is back and drew, a tile whose state is Starting again gets its card back.
 */

import { sanitizePackDisplayName } from "../graph/sanitize-pack-name";
import { hideSkyStartingCard, showSkyStartingCard } from "../graph/sky-starting-card";
import { onViewStateChange, viewStateCopy, viewStateOf, viewStateTile, viewStateTileEl, viewStateViewId } from "./view-state";

const SURFACE = "tile-cant-draw";
const FALLBACK = "tile-shader-fallback";

/** Display name for a tile's view (the copy falls back to "This view" when empty). */
export type CantDrawViewName = (viewId: string, packId: string) => string;

/** Pack tiles (#216): which views draw their own picture, and what Retry does for a tile. */
export type CantDrawPackTiles = {
  isPack: (viewId: string) => boolean;
  /** Ask for the lost context back (the host's restore); never begins a sky wait. */
  retry: (tileId: string) => void;
};

/** Paint, update or remove the tile's surface to match its view state now. */
export function paintCantDrawSurface(tileId: string, viewName: CantDrawViewName, pack?: CantDrawPackTiles): void {
  const el = viewStateTileEl(tileId);
  if (!el) return;
  const found = el.querySelector(`:scope > .${SURFACE}`);
  const existing = found instanceof HTMLElement ? found : null;
  const state = viewStateOf(tileId);
  const viewId = viewStateViewId(tileId) ?? tileId;
  const fallback = el.querySelector(`.${FALLBACK}`);
  const shaderLine = state?.kind === "cant-draw" && state.reason === "shader" && !fallback?.querySelector(`.${FALLBACK}-chip`);
  const packLoss = state?.kind === "cant-draw" && state.reason === "context-lost" && pack?.isPack(viewId) === true;
  if (state?.kind !== "cant-draw" || !(shaderLine || packLoss)) {
    const wasPackLoss = existing?.dataset.reason === "context-lost";
    existing?.remove();
    delete el.dataset.cantDrawSurface;
    // The context is back and drew while the pack's sky was still on its way: its card again.
    if (wasPackLoss && state?.kind === "starting") showSkyStartingCard(el, sanitizePackDisplayName(viewName(viewId, "")) || "This view");
    return;
  }
  const name = sanitizePackDisplayName(viewName(viewId, state.reason === "shader" ? state.packId : ""));
  const copy = viewStateCopy(state, name, viewStateTile(tileId, el), { pack: packLoss });
  if (packLoss) hideSkyStartingCard(el, false);
  el.dataset.cantDrawSurface = state.reason;
  const box = existing ?? document.createElement("div");
  if (!existing) {
    box.className = SURFACE;
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    el.appendChild(box);
  }
  box.dataset.viewState = "cant-draw";
  box.dataset.reason = state.reason;
  const text = document.createElement("span");
  text.className = `${SURFACE}__text`;
  text.textContent = copy.text ?? "";
  if (!copy.button || !pack) {
    box.replaceChildren(text);
    return;
  }
  // Keep the same button across repaints (Restoring -> Reload offered) so focus stays on it.
  const kept = box.querySelector(`:scope > .${SURFACE}__retry`);
  const button = kept instanceof HTMLButtonElement ? kept : document.createElement("button");
  button.type = "button";
  button.className = `${SURFACE}__retry`;
  button.textContent = copy.button;
  if (copy.action) button.dataset.action = copy.action;
  button.onclick = () => pack.retry(tileId);
  // #251: the press stays on Retry. The tile's orbit handler (on the hosted tile) would capture the
  // pointer, and a captured pointerup moves the click off Retry (as pack-asset-pane-notice's Retry).
  button.onpointerdown = (e) => e.stopPropagation();
  box.replaceChildren(text, button);
}

/** Keep every tile's surface in step with its view state; returns the unsubscribe. */
export function bindCantDrawSurface(viewName: CantDrawViewName, pack?: CantDrawPackTiles): () => void {
  return onViewStateChange((tileId) => paintCantDrawSurface(tileId, viewName, pack));
}
