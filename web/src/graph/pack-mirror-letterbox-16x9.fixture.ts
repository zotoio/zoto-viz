import { letterboxInnerRectInto } from "./letterbox-fill";
import { asCanvasDeviceHeight, deviceRectFromHostViewBoxInto, toGlRectInto } from "./pack-mirror-rect";

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

/** Inner content viewport in GL device pixels (renderer pixel ratio must be 1). */
export function letterbox16x9InnerViewportGl(
  layoutPixelRatio: number,
  tile = LETTERBOX_TILE_CSS,
): { x: number; y: number; w: number; h: number } {
  const bl = letterbox16x9InnerViewportBottomLeft(tile);
  const devH = Math.max(1, Math.round(tile * layoutPixelRatio));
  const dev = { x: 0, y: 0, w: 0, h: 0 };
  deviceRectFromHostViewBoxInto(bl, false, tile, layoutPixelRatio, dev, asCanvasDeviceHeight(devH));
  const gl = { x: 0, y: 0, w: 0, h: 0 };
  toGlRectInto(dev as never, asCanvasDeviceHeight(devH), gl);
  return { x: gl.x, y: gl.y, w: gl.w, h: gl.h };
}

/** Device Y (GL bottom-left) of the first scene row above the inner viewport bottom edge. */
export function letterbox16x9FirstSceneRowDeviceY(layoutPixelRatio: number, tile = LETTERBOX_TILE_CSS): number {
  const vp = letterbox16x9InnerViewportGl(layoutPixelRatio, tile);
  return vp.y + vp.h;
}
