import {
  type CanvasDeviceHeight,
  type CssRectLoose,
  type DeviceRect,
  type DeviceRectMut,
  type GlRectMut,
  deviceRectFromHostViewBoxInto,
  toGlRectInto,
} from "./pack-mirror-rect";

export type GlViewportRenderer = {
  setViewport(x: number, y: number, w: number, h: number): void;
  setScissor(x: number, y: number, w: number, h: number): void;
  setScissorTest(on: boolean): void;
};

/** Apply a top-left `DeviceRect` to Three.js viewport/scissor (GL bottom-left coords). Renderer pixel ratio must be 1. */
export function applyDeviceRectToGlRenderer(
  renderer: GlViewportRenderer,
  rect: DeviceRect,
  canvasDeviceHeight: CanvasDeviceHeight,
  glScratch: GlRectMut,
): void {
  toGlRectInto(rect, canvasDeviceHeight, glScratch);
  renderer.setScissorTest(true);
  renderer.setViewport(glScratch.x, glScratch.y, glScratch.w, glScratch.h);
  renderer.setScissor(glScratch.x, glScratch.y, glScratch.w, glScratch.h);
}

/** Host GPU pane box (bottom-left CSS) → per-edge device rect → GL viewport/scissor. */
export function applyHostViewBoxToGlRenderer(
  renderer: GlViewportRenderer,
  box: CssRectLoose,
  canvasCssHeight: number,
  layoutPixelRatio: number,
  canvasDeviceHeight: CanvasDeviceHeight,
  deviceScratch: DeviceRectMut,
  glScratch: GlRectMut,
): DeviceRect {
  const dev = deviceRectFromHostViewBoxInto(
    box,
    false,
    canvasCssHeight,
    layoutPixelRatio,
    deviceScratch,
    canvasDeviceHeight,
  );
  applyDeviceRectToGlRenderer(renderer, dev, canvasDeviceHeight, glScratch);
  return dev;
}
