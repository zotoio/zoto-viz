import * as THREE from "three";
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
>;

export type MirrorRenderer = Pick<
  WebGLRenderer,
  | "resetState"
  | "setScissorTest"
  | "setViewport"
  | "setScissor"
  | "setClearColor"
  | "clear"
  | "getPixelRatio"
  | "setRenderTarget"
  | "render"
  | "properties"
>;

function clearRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Scissored `gl.clear` for each letterbox bar (surface colour); no per-frame array allocation. */
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
  const bx = box.x;
  const by = box.y;
  const bw = box.w;
  const bh = box.h;
  const ix = inner.x;
  const iy = inner.y;
  const iw = inner.w;
  const ih = inner.h;
  const topH = Math.max(0, iy - by);
  if (bw >= 1 && topH >= 1) {
    gl.scissor(Math.round(bx * pr), Math.round(by * pr), Math.round(bw * pr), Math.round(topH * pr));
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  const botY = iy + ih;
  const botH = Math.max(0, by + bh - botY);
  if (bw >= 1 && botH >= 1) {
    gl.scissor(Math.round(bx * pr), Math.round(botY * pr), Math.round(bw * pr), Math.round(botH * pr));
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  const leftW = Math.max(0, ix - bx);
  if (leftW >= 1 && ih >= 1) {
    gl.scissor(Math.round(bx * pr), Math.round(iy * pr), Math.round(leftW * pr), Math.round(ih * pr));
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  const rightX = ix + iw;
  const rightW = Math.max(0, bx + bw - rightX);
  if (rightW >= 1 && ih >= 1) {
    gl.scissor(Math.round(rightX * pr), Math.round(iy * pr), Math.round(rightW * pr), Math.round(ih * pr));
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.disable(gl.SCISSOR_TEST);
}

function packRtFramebuffer(renderer: MirrorRenderer, rt: THREE.WebGLRenderTarget): WebGLFramebuffer | null {
  const props = renderer.properties.get(rt) as { __webGLFramebuffer?: WebGLFramebuffer };
  return props.__webGLFramebuffer ?? null;
}

/**
 * Non-MSAA render target for a coalesced pack (render here, then blit to default — never read blit MSAA default).
 */
export class PackMirrorGl {
  private rt: THREE.WebGLRenderTarget | null = null;
  private tw = 0;
  private th = 0;
  private packReady = false;
  private readonly scratchBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly scratchInner = { x: 0, y: 0, w: 0, h: 0 };

  beginFrame(): void {
    this.packReady = false;
  }

  hasCapture(): boolean {
    return this.packReady;
  }

  dispose(_gl: GlMirror, renderer?: MirrorRenderer): void {
    if (this.rt && renderer) renderer.properties.remove(this.rt);
    this.rt?.dispose();
    this.rt = null;
    this.tw = 0;
    this.th = 0;
    this.packReady = false;
  }

  /** Non-MSAA target sized to the primary tile (framebuffer pixels). */
  ensureRenderTarget(renderer: MirrorRenderer, w: number, h: number): THREE.WebGLRenderTarget | null {
    if (w < 2 || h < 2) return null;
    if (this.rt && this.rt.width === w && this.rt.height === h) return this.rt;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.tw = w;
    this.th = h;
    return this.rt;
  }

  markPackRendered(): void {
    this.packReady = true;
  }

  private layoutLetterbox(
    dst: { x: number; y: number; w: number; h: number },
    contentAspect: number,
  ): { ix: number; iy: number; iw: number; ih: number } {
    const inner = letterboxInnerRect(dst, contentAspect);
    this.scratchBox.x = dst.x;
    this.scratchBox.y = dst.y;
    this.scratchBox.w = dst.w;
    this.scratchBox.h = dst.h;
    this.scratchInner.x = dst.x + inner.x;
    this.scratchInner.y = dst.y + inner.y;
    this.scratchInner.w = inner.w;
    this.scratchInner.h = inner.h;
    return {
      ix: this.scratchInner.x,
      iy: this.scratchInner.y,
      iw: this.scratchInner.w,
      ih: this.scratchInner.h,
    };
  }

  private blitPackToDefault(
    gl: GlMirror,
    renderer: MirrorRenderer,
    fill: SurfaceLetterboxFill,
    dst: { x: number; y: number; w: number; h: number },
    pr: number,
    contentAspect: number,
    opts: { letterbox: boolean; flipY?: boolean },
  ): { x: number; y: number; w: number; h: number } {
    const dX = Math.round(dst.x * pr);
    const dY = Math.round(dst.y * pr);
    const dW = Math.round(dst.w * pr);
    const dH = Math.round(dst.h * pr);
    renderer.setScissorTest(true);
    renderer.setViewport(dX, dY, dW, dH);
    renderer.setScissor(dX, dY, dW, dH);
    let ix: number;
    let iy: number;
    let iw: number;
    let ih: number;
    if (opts.letterbox) {
      const laid = this.layoutLetterbox(dst, contentAspect);
      ix = Math.round(laid.ix * pr);
      iy = Math.round(laid.iy * pr);
      iw = Math.round(laid.iw * pr);
      ih = Math.round(laid.ih * pr);
      paintLetterboxBarsGl(gl, fill, this.scratchBox, this.scratchInner, pr);
    } else {
      ix = dX;
      iy = dY;
      iw = dW;
      ih = dH;
    }
    const readFbo = this.rt ? packRtFramebuffer(renderer, this.rt) : null;
    if (readFbo && iw > 1 && ih > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      const dy0 = opts.flipY ? iy + ih : iy;
      const dy1 = opts.flipY ? iy : iy + ih;
      gl.blitFramebuffer(0, 0, this.tw, this.th, ix, dy0, ix + iw, dy1, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      renderer.resetState();
    }
    return { x: ix, y: iy, w: iw, h: ih };
  }

  /** Blit pack RT into the primary tile (full viewport, no letterbox). */
  blitPrimaryToDefault(
    gl: GlMirror,
    renderer: MirrorRenderer,
    dst: { x: number; y: number; w: number; h: number },
    pr: number,
  ): { x: number; y: number; w: number; h: number } {
    return this.blitPackToDefault(gl, renderer, { css: "", grain: 0 }, dst, pr, dst.w / Math.max(1, dst.h), {
      letterbox: false,
    });
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
    return this.blitPackToDefault(gl, renderer, fill, dst, pr, contentAspect, { letterbox: true });
  }
}

/** One GPU texture per duplicated sandbox pack; `texSubImage2D` per frame, realloc on size change only. */
export class SandboxBitmapGl {
  private readFbo: WebGLFramebuffer | null = null;
  private tex: WebGLTexture | null = null;
  private tw = 0;
  private th = 0;
  private readonly scratchBox = { x: 0, y: 0, w: 0, h: 0 };
  private readonly scratchInner = { x: 0, y: 0, w: 0, h: 0 };

  dispose(gl: GlMirror): void {
    if (this.readFbo) gl.deleteFramebuffer(this.readFbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.readFbo = null;
    this.tex = null;
    this.tw = 0;
    this.th = 0;
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
    this.scratchBox.x = dst.x;
    this.scratchBox.y = dst.y;
    this.scratchBox.w = dst.w;
    this.scratchBox.h = dst.h;
    this.scratchInner.x = dst.x + inner.x;
    this.scratchInner.y = dst.y + inner.y;
    this.scratchInner.w = inner.w;
    this.scratchInner.h = inner.h;
    const dX = Math.round(dst.x * pr);
    const dY = Math.round(dst.y * pr);
    const dW = Math.round(dst.w * pr);
    const dH = Math.round(dst.h * pr);
    const ix = Math.round(this.scratchInner.x * pr);
    const iy = Math.round(this.scratchInner.y * pr);
    const iw = Math.round(this.scratchInner.w * pr);
    const ih = Math.round(this.scratchInner.h * pr);
    renderer.setScissorTest(true);
    renderer.setViewport(dX, dY, dW, dH);
    renderer.setScissor(dX, dY, dW, dH);
    paintLetterboxBarsGl(gl, fill, this.scratchBox, this.scratchInner, pr);
    if (this.readFbo && iw > 1 && ih > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.tw, this.th, ix, iy + ih, ix + iw, iy, gl.COLOR_BUFFER_BIT, gl.LINEAR);
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

export function resetSandboxBitmapGl(gl?: GlMirror, renderer?: MirrorRenderer): void {
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
