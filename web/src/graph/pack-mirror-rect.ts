import { packMirrorSizeStats } from "./pack-mirror-size-stats";

/**
 * CSS vs device pixel rects for the shared render host.
 * Three.js viewport/scissor use CSS pixels; raw GL (readPixels, gl.viewport) use device pixels.
 */

export type CssRectLoose = { x: number; y: number; w: number; h: number };

export type CssRect = CssRectLoose & { readonly __unit: "css" };

export type DeviceRect = CssRectLoose & { readonly __unit: "device" };

export type DeviceRectMut = { x: number; y: number; w: number; h: number };

export type DeviceSizeMut = { pw: number; ph: number };

/** Non-finite or missing CSS box components become 0 before edge rounding. */
export function cssBoxDim(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

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

function deviceEdgesFromCss(
  r: CssRect,
  pixelRatio: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const pr = pixelRatio;
  return {
    x0: Math.round(r.x * pr),
    x1: Math.round((r.x + r.w) * pr),
    y0: Math.round(r.y * pr),
    y1: Math.round((r.y + r.h) * pr),
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

/** Device pixels (GL bottom-left) for viewport, scissor, readPixels, and blit — per-edge `Math.round`. */
export function toDeviceRectInto(
  r: CssRect,
  pixelRatio: number,
  canvasDeviceHeight: number,
  out: DeviceRectMut,
): DeviceRect {
  const { x0, x1, y0, y1 } = deviceEdgesFromCss(r, pixelRatio);
  return writeDeviceRectFromEdges(x0, x1, y0, y1, canvasDeviceHeight, out);
}

/** Device RT size from CSS tile edges (shared with adjacent tiles at non-integer DPR). */
export function deviceSizeFromCssBoxInto(
  box: CssRectLoose,
  pixelRatio: number,
  out: DeviceSizeMut,
): DeviceSizeMut {
  const pr = pixelRatio;
  const bx = cssBoxDim(box.x);
  const by = cssBoxDim(box.y);
  const bw = cssBoxDim(box.w);
  const bh = cssBoxDim(box.h);
  const x0 = Math.round(bx * pr);
  const x1 = Math.round((bx + bw) * pr);
  const y0 = Math.round(by * pr);
  const y1 = Math.round((by + bh) * pr);
  const pw = x1 - x0;
  const ph = y1 - y0;
  out.pw = Number.isFinite(pw) ? Math.max(2, pw) : 2;
  out.ph = Number.isFinite(ph) ? Math.max(2, ph) : 2;
  return out;
}

/** Allocating helper (harness / deprecated callers). Prefer `deviceSizeFromCssBoxInto` on the hot path. */
export function deviceSizeFromCssBox(
  box: CssRectLoose,
  pixelRatio: number,
): DeviceSizeMut {
  packMirrorSizeStats.deviceSizeAllocated += 1;
  return deviceSizeFromCssBoxInto(box, pixelRatio, { pw: 0, ph: 0 });
}

/** @deprecated Use `deviceSizeFromCssBoxInto`. */
export function deviceSizeFromCss(
  w: number,
  h: number,
  pixelRatio: number,
): DeviceSizeMut {
  return deviceSizeFromCssBox({ x: 0, y: 0, w, h }, pixelRatio);
}
