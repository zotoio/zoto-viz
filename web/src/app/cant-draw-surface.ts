/**
 * The per-tile "couldn't draw" surface (#179 c), painted from each tile's view state.
 *
 * Only `cant-draw` / `shader` is painted per tile: one tile's shader failed, the others still draw.
 * A lost context stops every tile at once, so it is never painted per tile (a screen reader would
 * read it once per tile): the wall notice (`GfxWallNotice`, one `role="status"` region) says it
 * once, and owns the only Reload button, shown exactly when the tiles' state carries `reload: true`
 * (UX Pro, #179 c).
 *
 * A tile whose shader pack already shows its own simple-view fallback (`.tile-shader-fallback`,
 * painted by the host's tile-shader latch) is left to that fallback, so no tile carries two messages.
 * The shader copy offers no button ("Pick another view, or reload to try again": both live elsewhere).
 */

import { onViewStateChange, viewStateCopy, viewStateOf, viewStateTileEl, viewStateViewId } from "./view-state";

const SURFACE = "tile-cant-draw";

/** Display name for a tile's view (the copy falls back to "This view" when empty). */
export type CantDrawViewName = (viewId: string, packId: string) => string;

/** How many tiles are on the wall now (1 = solo: the shader copy drops "Other tiles aren't affected"). */
export type CantDrawTileCount = () => number;

/** Paint, update or remove the tile's surface to match its view state now. */
export function paintCantDrawSurface(tileId: string, viewName: CantDrawViewName, tileCount?: CantDrawTileCount): void {
  const el = viewStateTileEl(tileId);
  if (!el) return;
  const found = el.querySelector(`:scope > .${SURFACE}`);
  const existing = found instanceof HTMLElement ? found : null;
  const state = viewStateOf(tileId);
  if (state?.kind !== "cant-draw" || state.reason !== "shader" || el.querySelector(".tile-shader-fallback")) {
    existing?.remove();
    return;
  }
  const copy = viewStateCopy(state, viewName(viewStateViewId(tileId) ?? tileId, state.packId), { tileId, tileCount: tileCount?.() });
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
  box.replaceChildren(text);
}

/** Keep every tile's surface in step with its view state; returns the unsubscribe. */
export function bindCantDrawSurface(viewName: CantDrawViewName, tileCount?: CantDrawTileCount): () => void {
  return onViewStateChange((tileId) => paintCantDrawSurface(tileId, viewName, tileCount));
}
