/**
 * Compile-time guards for the CSS/device rect boundary (included in `tsc`, not vitest).
 */
import type { MirrorRenderer } from "./pack-mirror-gl";
import {
  type CssRect,
  type DeviceRect,
  asCssRect,
  cssRect,
  toDeviceRect,
} from "./pack-mirror-rect";

export function setRendererViewport(renderer: MirrorRenderer, rect: CssRect): void {
  renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
}

export function setRendererScissor(renderer: MirrorRenderer, rect: CssRect): void {
  renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
}

export function glReadPixels1x1(
  gl: WebGL2RenderingContext,
  pt: DeviceRect,
  buf: Uint8Array,
): void {
  gl.readPixels(pt.x, pt.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
}

function _packMirrorRectBoundaryTypeChecks(
  gl: WebGL2RenderingContext,
  renderer: MirrorRenderer,
): void {
  const css = cssRect(0, 0, 10, 10);
  const dev = toDeviceRect(css, 1);
  const loose = asCssRect({ x: 1, y: 2, w: 3, h: 4 });
  // @ts-expect-error DeviceRect must not be passed to Three.js viewport/scissor helpers.
  setRendererViewport(renderer, dev);
  // @ts-expect-error CssRect must not be passed to raw GL readPixels.
  glReadPixels1x1(gl, loose, new Uint8Array(4));
  void loose;
}

if (import.meta.env.DEV) {
  void _packMirrorRectBoundaryTypeChecks;
}
