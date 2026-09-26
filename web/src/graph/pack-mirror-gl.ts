import type { SurfaceLetterboxFill } from "./letterbox-fill";
import { letterboxFillHex, letterboxInnerRect } from "./letterbox-fill";
import type { WebGLRenderer } from "three";

export type GlMirror = Pick<
  WebGL2RenderingContext,
  | "bindFramebuffer"
  | "blitFramebuffer"
  | "createFramebuffer"
  | "createTexture"
  | "deleteFramebuffer"
  | "deleteTexture"
  | "enable"
  | "disable"
  | "scissor"
  | "viewport"
  | "clearColor"
  | "clear"
  | "texParameteri"
  | "texImage2D"
  | "texSubImage2D"
  | "framebufferTexture2D"
  | "bindTexture"
  | "pixelStorei"
  | "readPixels"
  | "COLOR_BUFFER_BIT"
  | "FRAMEBUFFER"
  | "READ_FRAMEBUFFER"
  | "DRAW_FRAMEBUFFER"
  | "COLOR_ATTACHMENT0"
  | "TEXTURE_2D"
  | "RGBA"
  | "UNSIGNED_BYTE"
  | "LINEAR"
  | "NEAREST"
  | "TEXTURE_MIN_FILTER"
  | "TEXTURE_MAG_FILTER"
  | "SCISSOR_TEST"
  | "UNPACK_FLIP_Y_WEBGL"
  | "UNPACK_PREMULTIPLY_ALPHA_WEBGL"
>;

export type MirrorRenderer = Pick<WebGLRenderer, "resetState" | "setScissorTest" | "setViewport" | "setScissor" | "setClearColor" | "clear" | "getPixelRatio">;

function clearRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Scissored `gl.clear` for each letterbox bar (surface colour). */
export function paintLetterboxBarsGl(
  gl: GlMirror,
  fill: SurfaceLetterboxFill,
  box: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
  pr: number,
): void {
  const hex = letterboxFillHex(fill);
  const [r, g, b] = clearRgb(hex);
  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(r, g, b, 1);
  const bars = [
    { x: box.x, y: box.y, w: box.w, h: Math.max(0, inner.y - box.y) },
    { x: box.x, y: inner.y + inner.h, w: box.w, h: Math.max(0, box.y + box.h - inner.y - inner.h) },
    { x: box.x, y: inner.y, w: Math.max(0, inner.x - box.x), h: inner.h },
    { x: inner.x + inner.w, y: inner.y, w: Math.max(0, box.x + box.w - inner.x - inner.w), h: inner.h },
  ];
  for (const bar of bars) {
    if (bar.w < 1 || bar.h < 1) continue;
    const x = Math.round(bar.x * pr);
    const y = Math.round(bar.y * pr);
    const w = Math.round(bar.w * pr);
    const h = Math.round(bar.h * pr);
    gl.scissor(x, y, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.disable(gl.SCISSOR_TEST);
}

/**
 * Non-MSAA render target for the primary pack tile (one blit source for all duplicates).
 * Target-to-default blits only — never default-to-default.
 */
export class PackMirrorGl {
  private readFbo: WebGLFramebuffer | null = null;
  private tex: WebGLTexture | null = null;
  private tw = 0;
  private th = 0;
  private captured = false;

  beginFrame(): void {
    this.captured = false;
  }

  hasCapture(): boolean {
    return this.captured;
  }

  dispose(gl: GlMirror): void {
    if (this.readFbo) gl.deleteFramebuffer(this.readFbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.readFbo = null;
    this.tex = null;
    this.tw = 0;
    this.th = 0;
    this.captured = false;
  }

  ensureTarget(gl: GlMirror, w: number, h: number): void {
    if (w < 2 || h < 2) return;
    if (this.tex && w === this.tw && h === this.th) return;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.readFbo) gl.deleteFramebuffer(this.readFbo);
    this.tw = w;
    this.th = h;
    this.tex = gl.createTexture();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.readFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.readFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** After the primary tile renders to the default framebuffer, copy it into the pack RT (legal default→RT blit). */
  capturePrimaryFromDefault(
    gl: GlMirror,
    renderer: MirrorRenderer,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): void {
    const sizeChanged = sw !== this.tw || sh !== this.th;
    if (this.captured && !sizeChanged) return;
    this.ensureTarget(gl, sw, sh);
    if (!this.readFbo) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.readFbo);
    gl.blitFramebuffer(sx, sy, sx + sw, sy + sh, 0, 0, sw, sh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    renderer.resetState();
    this.captured = true;
  }

  /** Blit pack RT into a duplicate tile's letterboxed inner rect; bars via scissored clear. */
  blitDuplicateToDefault(
    gl: GlMirror,
    renderer: MirrorRenderer,
    fill: SurfaceLetterboxFill,
    dst: { x: number; y: number; w: number; h: number },
    pr: number,
    contentAspect: number,
  ): { x: number; y: number; w: number; h: number } {
    const inner = letterboxInnerRect(dst, contentAspect);
    inner.x += dst.x;
    inner.y += dst.y;
    const box = { ...dst };
    const dX = Math.round(dst.x * pr);
    const dY = Math.round(dst.y * pr);
    const dW = Math.round(dst.w * pr);
    const dH = Math.round(dst.h * pr);
    const ix = Math.round(inner.x * pr);
    const iy = Math.round(inner.y * pr);
    const iw = Math.round(inner.w * pr);
    const ih = Math.round(inner.h * pr);
    renderer.setScissorTest(true);
    renderer.setViewport(dX, dY, dW, dH);
    renderer.setScissor(dX, dY, dW, dH);
    paintLetterboxBarsGl(gl, fill, box, inner, pr);
    if (this.readFbo && iw > 1 && ih > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.tw, this.th, ix, iy, ix + iw, iy + ih, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      renderer.resetState();
    }
    return { x: ix, y: iy, w: iw, h: ih };
  }
}

/** One GPU texture per duplicated sandbox pack; `texSubImage2D` per frame, realloc on size change only. */
export class SandboxBitmapGl {
  private readFbo: WebGLFramebuffer | null = null;
  private tex: WebGLTexture | null = null;
  private tw = 0;
  private th = 0;
  private unpackReady = false;

  dispose(gl: GlMirror): void {
    if (this.readFbo) gl.deleteFramebuffer(this.readFbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.readFbo = null;
    this.tex = null;
    this.tw = 0;
    this.th = 0;
    this.unpackReady = false;
  }

  private ensureUnpack(gl: GlMirror): void {
    if (this.unpackReady) return;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    this.unpackReady = true;
  }

  ensureTarget(gl: GlMirror, w: number, h: number): void {
    if (w < 2 || h < 2) return;
    this.ensureUnpack(gl);
    if (this.tex && w === this.tw && h === this.th) return;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.readFbo) gl.deleteFramebuffer(this.readFbo);
    this.tw = w;
    this.th = h;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.readFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.readFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Upload sandbox bitmap pixels, then close it (no readback). */
  uploadFrame(gl: GlMirror, renderer: MirrorRenderer, bitmap: ImageBitmap): void {
    this.ensureTarget(gl, bitmap.width, bitmap.height);
    if (!this.tex) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    bitmap.close();
    renderer.resetState();
  }

  blitToDefault(
    gl: GlMirror,
    renderer: MirrorRenderer,
    fill: SurfaceLetterboxFill,
    dst: { x: number; y: number; w: number; h: number },
    pr: number,
    contentAspect: number,
  ): { x: number; y: number; w: number; h: number } {
    const inner = letterboxInnerRect(dst, contentAspect);
    inner.x += dst.x;
    inner.y += dst.y;
    const box = { ...dst };
    const dX = Math.round(dst.x * pr);
    const dY = Math.round(dst.y * pr);
    const dW = Math.round(dst.w * pr);
    const dH = Math.round(dst.h * pr);
    const ix = Math.round(inner.x * pr);
    const iy = Math.round(inner.y * pr);
    const iw = Math.round(inner.w * pr);
    const ih = Math.round(inner.h * pr);
    renderer.setScissorTest(true);
    renderer.setViewport(dX, dY, dW, dH);
    renderer.setScissor(dX, dY, dW, dH);
    paintLetterboxBarsGl(gl, fill, box, inner, pr);
    if (this.readFbo && iw > 1 && ih > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.tw, this.th, ix, iy, ix + iw, iy + ih, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      renderer.resetState();
    }
    return { x: ix, y: iy, w: iw, h: ih };
  }
}

const sandboxGpu = new Map<string, SandboxBitmapGl>();

export function sandboxBitmapGl(pluginId: string): SandboxBitmapGl {
  let gpu = sandboxGpu.get(pluginId);
  if (!gpu) {
    gpu = new SandboxBitmapGl();
    sandboxGpu.set(pluginId, gpu);
  }
  return gpu;
}

export function resetSandboxBitmapGl(gl?: GlMirror): void {
  if (gl) {
    for (const gpu of sandboxGpu.values()) gpu.dispose(gl);
  }
  sandboxGpu.clear();
}

export function teardownSandboxBitmapGl(pluginId: string, gl: GlMirror): void {
  const gpu = sandboxGpu.get(pluginId);
  if (gpu) {
    gpu.dispose(gl);
    sandboxGpu.delete(pluginId);
  }
}
