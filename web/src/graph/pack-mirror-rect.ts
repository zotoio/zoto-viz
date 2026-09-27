import { packMirrorSizeStats } from "./pack-mirror-size-stats";

/**
 * CSS vs device pixel rects for the shared render host.
 * `DeviceRect` is top-left device pixels (Canvas2D / `getImageData`).
 * `GlRect` is bottom-left device pixels (raw GL `readPixels` / pack buffer).
 */

export type CssRectLoose = { x: number; y: number; w: number; h: number };

export type CssRect = CssRectLoose & { readonly __unit: "css" };

/** Top-left origin, device pixels. */
export type DeviceRect = CssRectLoose & { readonly __unit: "device" };

/** Bottom-left origin, device pixels — only produced by `toGlRectInto`. */
export type GlRect = CssRectLoose & { readonly __unit: "gl" };

export type DeviceRectMut = { x: number; y: number; w: number; h: number };
export type GlRectMut = { x: number; y: number; w: number; h: number };

export type DeviceSizeMut = { pw: number; ph: number };

/** Canvas backing-store height in device pixels (`canvas.height`); not CSS layout height. */
export type CanvasDeviceHeight = number & { readonly __brand: "canvasDevicePx" };

export function asCanvasDeviceHeight(px: number): CanvasDeviceHeight {
  return px as CanvasDeviceHeight;
}

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

export function viewMutAsDeviceRect(m: DeviceRectMut): DeviceRect {
  return m as DeviceRect;
}

export function viewMutAsGlRect(m: GlRectMut): GlRect {
  return m as GlRect;
}

export function isDeviceRect(vp: { __unit?: string }): vp is DeviceRect {
  return vp.__unit === "device";
}

export function deviceRect(x: number, y: number, w: number, h: number): DeviceRect {
  return { x, y, w, h, __unit: "device" };
}

function writeDeviceEdgesFromCss(
  r: CssRect,
  pixelRatio: number,
  out: { x0: number; x1: number; y0: number; y1: number },
): void {
  const pr = pixelRatio;
  out.x0 = Math.round(r.x * pr);
  out.x1 = Math.round((r.x + r.w) * pr);
  out.y0 = Math.round(r.y * pr);
  out.y1 = Math.round((r.y + r.h) * pr);
}

const deviceEdgeScratch = { x0: 0, x1: 0, y0: 0, y1: 0 };

/** Top-left CSS → top-left `DeviceRect` (per-edge `Math.round`). */
export function toDeviceRectInto(
  r: CssRect,
  pixelRatio: number,
  out: DeviceRectMut,
): DeviceRect {
  writeDeviceEdgesFromCss(r, pixelRatio, deviceEdgeScratch);
  out.x = deviceEdgeScratch.x0;
  out.y = deviceEdgeScratch.y0;
  out.w = deviceEdgeScratch.x1 - deviceEdgeScratch.x0;
  out.h = deviceEdgeScratch.y1 - deviceEdgeScratch.y0;
  Object.defineProperty(out, "__unit", { value: "device", enumerable: true });
  return out as DeviceRect;
}

/** Sole producer of `GlRect`: flip top-left device rect to GL bottom-left using canvas device height. */
export function toGlRectInto(
  rect: DeviceRect,
  canvasDevicePx: CanvasDeviceHeight,
  out: GlRectMut,
): GlRect {
  out.x = rect.x;
  out.w = rect.w;
  out.h = rect.h;
  out.y = canvasDevicePx - rect.y - rect.h;
  Object.defineProperty(out, "__unit", { value: "gl", enumerable: true });
  return out as GlRect;
}

/** Host pane box → top-left device rect (`software`: top-left CSS box; GPU: bottom-left CSS box). */
export function deviceRectFromHostViewBoxInto(
  box: CssRectLoose,
  software: boolean,
  canvasCssHeight: number,
  pixelRatio: number,
  out: DeviceRectMut,
  canvasDevicePx?: CanvasDeviceHeight,
): DeviceRect {
  if (software) {
    return deviceRectTopLeftCssInto(box, pixelRatio, out);
  }
  const topY = canvasCssHeight - cssBoxDim(box.y) - cssBoxDim(box.h);
  toDeviceRectInto(
    cssRect(box.x, topY, box.w, box.h),
    pixelRatio,
    out,
  );
  if (canvasDevicePx !== undefined) {
    const cap = canvasDevicePx;
    const y1 = out.y + out.h;
    if (y1 > cap) {
      out.y = Math.floor(topY * pixelRatio);
      out.h = Math.max(0, cap - out.y);
    }
  }
  return out as DeviceRect;
}

/** Top-left CSS box → top-left device pixels (Canvas2D `getImageData`). */
export function deviceRectTopLeftCssInto(
  box: CssRectLoose,
  pixelRatio: number,
  out: DeviceRectMut,
): DeviceRect {
  const pr = pixelRatio;
  const x0 = Math.round(cssBoxDim(box.x) * pr);
  const x1 = Math.round((cssBoxDim(box.x) + cssBoxDim(box.w)) * pr);
  const y0 = Math.round(cssBoxDim(box.y) * pr);
  const y1 = Math.round((cssBoxDim(box.y) + cssBoxDim(box.h)) * pr);
  out.x = x0;
  out.y = y0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  Object.defineProperty(out, "__unit", { value: "device", enumerable: true });
  return out as DeviceRect;
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
