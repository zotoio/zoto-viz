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

/** Host viewBox is bottom-left CSS; converters expect top-left CSS (y down). */
export function cssRectTopFromBottomLeft(
  box: CssRectLoose,
  canvasCssHeight: number,
): CssRect {
  return cssRect(box.x, canvasCssHeight - box.y - box.h, box.w, box.h);
}

export function deviceRect(x: number, y: number, w: number, h: number): DeviceRect {
  return { x, y, w, h, __unit: "device" };
}

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

type EdgeMode = "viewport" | "capture";

function deviceEdgesFromCss(
  r: CssRect,
  pixelRatio: number,
  mode: EdgeMode,
): { x0: number; x1: number; y0: number; y1: number } {
  const pr = resolveReadbackPixelRatio(pixelRatio);
  if (mode === "viewport") {
    return {
      x0: Math.round(r.x * pr),
      x1: Math.round((r.x + r.w) * pr),
      y0: Math.round(r.y * pr),
      y1: Math.round((r.y + r.h) * pr),
    };
  }
  return {
    x0: Math.floor(r.x * pr),
    x1: Math.ceil((r.x + r.w) * pr),
    y0: Math.floor(r.y * pr),
    y1: Math.ceil((r.y + r.h) * pr),
  };
}

function writeDeviceRectFromEdges(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  canvasDeviceHeight: number,
  out: DeviceRectMut,
): DeviceRect {
  out.x = x0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  out.y = canvasDeviceHeight - y1;
  return out as DeviceRect;
}

/** Viewport / scissor in device pixels (GL bottom-left); edges rounded with `Math.round`. */
export function toDeviceRectInto(
  r: CssRect,
  pixelRatio: number,
  canvasDeviceHeight: number,
  out: DeviceRectMut,
): DeviceRect {
  const { x0, x1, y0, y1 } = deviceEdgesFromCss(r, pixelRatio, "viewport");
  return writeDeviceRectFromEdges(x0, x1, y0, y1, canvasDeviceHeight, out);
}

/** readPixels / blit sources; start rounded down, end rounded up. */
export function toDeviceCaptureRectInto(
  r: CssRect,
  pixelRatio: number,
  canvasDeviceHeight: number,
  out: DeviceRectMut,
): DeviceRect {
  const { x0, x1, y0, y1 } = deviceEdgesFromCss(r, pixelRatio, "capture");
  return writeDeviceRectFromEdges(x0, x1, y0, y1, canvasDeviceHeight, out);
}

/** Device RT size from CSS tile edges (shared with adjacent tiles at non-integer DPR). */
export function deviceSizeFromCssBox(
  box: CssRectLoose,
  pixelRatio: number,
): { pw: number; ph: number } {
  const pr = pixelRatio;
  const x0 = Math.round(box.x * pr);
  const x1 = Math.round((box.x + box.w) * pr);
  const y0 = Math.round(box.y * pr);
  const y1 = Math.round((box.y + box.h) * pr);
  return {
    pw: Math.max(2, x1 - x0),
    ph: Math.max(2, y1 - y0),
  };
}

/** @deprecated Use `deviceSizeFromCssBox`. */
export function deviceSizeFromCss(
  w: number,
  h: number,
  pixelRatio: number,
): { pw: number; ph: number } {
  return deviceSizeFromCssBox({ x: 0, y: 0, w, h }, pixelRatio);
}
