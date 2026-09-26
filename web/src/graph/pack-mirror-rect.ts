/**
 * CSS vs device pixel rects for the shared render host.
 * Three.js viewport/scissor use CSS pixels; raw GL (readPixels, gl.viewport) use device pixels.
 */

export type CssRectLoose = { x: number; y: number; w: number; h: number };

export type CssRect = CssRectLoose & { readonly __unit: "css" };

export type DeviceRect = CssRectLoose & { readonly __unit: "device" };

export type DeviceRectMut = { x: number; y: number; w: number; h: number };

export function cssRect(x: number, y: number, w: number, h: number): CssRect {
  return { x, y, w, h, __unit: "css" };
}

export function asCssRect(r: CssRectLoose): CssRect {
  return r as CssRect;
}

export function deviceRect(x: number, y: number, w: number, h: number): DeviceRect {
  return { x, y, w, h, __unit: "device" };
}

/** Same rounding as pack mirror tile layout (`Math.round(css * pixelRatio)` per edge). */
export function toDeviceRect(
  r: CssRect,
  pixelRatio: number,
  out: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 },
): DeviceRect {
  const pr = resolveReadbackPixelRatio(pixelRatio);
  out.x = Math.round(r.x * pr);
  out.y = Math.round(r.y * pr);
  out.w = Math.round(r.w * pr);
  out.h = Math.round(r.h * pr);
  return out as DeviceRect;
}

/** Revert-proof row `pack-mirror-device-pixel-ratio`: use window DPR instead of renderer ratio. */
function resolveReadbackPixelRatio(rendererPixelRatio: number): number {
  if (import.meta.env.DEV && typeof globalThis !== "undefined") {
    const flag = (globalThis as { __ZOTO_PACK_MIRROR_REVERT_WINDOW_DPR__?: boolean })
      .__ZOTO_PACK_MIRROR_REVERT_WINDOW_DPR__;
    if (flag && typeof devicePixelRatio === "number" && devicePixelRatio > 0) {
      return devicePixelRatio;
    }
  }
  return rendererPixelRatio;
}

export function deviceSizeFromCss(
  w: number,
  h: number,
  pixelRatio: number,
): { pw: number; ph: number } {
  return {
    pw: Math.max(2, Math.round(w * pixelRatio)),
    ph: Math.max(2, Math.round(h * pixelRatio)),
  };
}

export function cssPointToDevice(
  x: number,
  y: number,
  pixelRatio: number,
): { x: number; y: number } {
  const pr = resolveReadbackPixelRatio(pixelRatio);
  return { x: Math.round(x * pr), y: Math.round(y * pr) };
}
