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
 * capability copy) is replaced by this surface's "couldn't draw" sentence, painted into the fallback.
 * The shader copy offers no button ("Pick another view, or reload to try again": both live elsewhere).
 * While the line shows, the tile's floating graph labels (`.label`) are hidden: the tile carries
 * `data-cant-draw-surface`, and style.css hides `.label` under it (only that tile's labels).
 * The name goes through `sanitizePackDisplayName` (empty: viewStateCopy says "This view") and reaches
 * the DOM as textContent only.
 * Where it lands comes from TSE's `viewStateTile(tileId, el)`: "main" is the solo wall (1 tile), a
 * mosaic pane counts the panes on its wall, so a solo tile drops "Other tiles aren't affected".
 */

import { sanitizePackDisplayName } from "../graph/sanitize-pack-name";
import { onViewStateChange, viewStateCopy, viewStateOf, viewStateTile, viewStateTileEl, viewStateViewId } from "./view-state";

const SURFACE = "tile-cant-draw";
const FALLBACK = "tile-shader-fallback";

/** Display name for a tile's view (the copy falls back to "This view" when empty). */
export type CantDrawViewName = (viewId: string, packId: string) => string;

/** Paint, update or remove the tile's surface to match its view state now. */
export function paintCantDrawSurface(tileId: string, viewName: CantDrawViewName): void {
  const el = viewStateTileEl(tileId);
  if (!el) return;
  const found = el.querySelector(`:scope > .${SURFACE}`);
  const existing = found instanceof HTMLElement ? found : null;
  const state = viewStateOf(tileId);
  const fallback = el.querySelector(`.${FALLBACK}`);
  if (state?.kind !== "cant-draw" || state.reason !== "shader" || fallback?.querySelector(`.${FALLBACK}-chip`)) {
    existing?.remove();
    delete el.dataset.cantDrawSurface;
    return;
  }
  const name = sanitizePackDisplayName(viewName(viewStateViewId(tileId) ?? tileId, state.packId));
  const line = viewStateCopy(state, name, viewStateTile(tileId, el)).text ?? "";
  el.dataset.cantDrawSurface = state.reason;
  const fallbackText = fallback?.querySelector(`.${FALLBACK}__text`);
  if (fallbackText) {
    existing?.remove();
    fallbackText.textContent = line;
    return;
  }
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
  text.textContent = line;
  box.replaceChildren(text);
}

/** Keep every tile's surface in step with its view state; returns the unsubscribe. */
export function bindCantDrawSurface(viewName: CantDrawViewName): () => void {
  return onViewStateChange((tileId) => paintCantDrawSurface(tileId, viewName));
}
