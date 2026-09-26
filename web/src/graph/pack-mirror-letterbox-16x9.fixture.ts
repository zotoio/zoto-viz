import { letterboxInnerRectInto } from "./letterbox-fill";

/** Square mirror tile (CSS px). */
export const LETTERBOX_TILE_CSS = 100;

/** Primary pack scene aspect (16:9). */
export const LETTERBOX_SCENE_ASPECT = 16 / 9;

/** Inner content viewport in bottom-left CSS (what `PackTexturePresenter.draw` passes to `setViewport`). */
export function letterbox16x9InnerViewportBottomLeft(
  tile = LETTERBOX_TILE_CSS,
): { x: number; y: number; w: number; h: number } {
  const innerTd = { x: 0, y: 0, w: 0, h: 0 };
  letterboxInnerRectInto({ w: tile, h: tile }, LETTERBOX_SCENE_ASPECT, innerTd);
  return {
    x: innerTd.x,
    y: tile - innerTd.y - innerTd.h,
    w: innerTd.w,
    h: innerTd.h,
  };
}

/** Device Y (GL bottom-left) of the first scene row above the inner viewport bottom edge. */
export function letterbox16x9FirstSceneRowDeviceY(pr: number, tile = LETTERBOX_TILE_CSS): number {
  const vp = letterbox16x9InnerViewportBottomLeft(tile);
  return Math.round((vp.y + vp.h) * pr);
}

/** Bottom-left CSS Y at the vertical centre of the top letterbox bar. */
export function letterbox16x9TopBarCenterBottomLeft(
  tile = LETTERBOX_TILE_CSS,
): number {
  const vp = letterbox16x9InnerViewportBottomLeft(tile);
  const innerTop = vp.y + vp.h;
  const tileTop = tile;
  return innerTop + (tileTop - innerTop) * 0.5;
}
