/**
 * Compile-time guards for the CSS/device rect boundary (included in `tsc -p tsconfig.test.json`, not vitest).
 */
type MirrorRenderer = {
  setViewport(x: number, y: number, w: number, h: number): void;
  setScissor(x: number, y: number, w: number, h: number): void;
};
import {
  type CssRect,
  type DeviceRect,
  type DeviceRectMut,
  type GlRect,
  type GlRectMut,
  asCanvasDeviceHeight,
  asCssRect,
  cssRect,
  deviceRect,
  toDeviceRectInto,
  toGlRectInto,
} from "../src/graph/pack-mirror-rect";

const _deviceScratch: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
const _glScratch: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };

export function setRendererViewport(renderer: MirrorRenderer, rect: CssRect): void {
  renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
}

export function setRendererScissor(renderer: MirrorRenderer, rect: CssRect): void {
  renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
}

export function glReadPixels1x1(
  gl: WebGL2RenderingContext,
  pt: GlRect,
  buf: Uint8Array,
): void {
  gl.readPixels(pt.x, pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
}

function _packMirrorRectBoundaryTypeChecks(
  gl: WebGL2RenderingContext,
  renderer: MirrorRenderer,
): void {
  const css = cssRect(0, 0, 10, 10);
  const dev = toDeviceRectInto(css, 1, _deviceScratch);
  const glRectOnly = toGlRectInto(dev, asCanvasDeviceHeight(180), _glScratch);
  const loose = asCssRect({ x: 1, y: 2, w: 3, h: 4 });
  // @ts-expect-error DeviceRect must not be passed to Three.js viewport/scissor helpers.
  setRendererViewport(renderer, dev);
  // @ts-expect-error CssRect must not be passed to raw GL readPixels.
  glReadPixels1x1(gl, loose, new Uint8Array(4));
  // @ts-expect-error GlRect must not be double-flipped through toGlRectInto.
  toGlRectInto(glRectOnly, asCanvasDeviceHeight(180), _glScratch);
  // @ts-expect-error canvas height must be branded CanvasDeviceHeight, not a plain number.
  toGlRectInto(dev, 180, _glScratch);
  // @ts-expect-error DeviceRect must not be passed to raw GL readPixels.
  glReadPixels1x1(gl, dev, new Uint8Array(4));
  void loose;
}

if (import.meta.env.DEV) {
  void _packMirrorRectBoundaryTypeChecks;
}
