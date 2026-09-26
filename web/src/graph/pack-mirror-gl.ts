import type { SurfaceLetterboxFill } from "./letterbox-fill";
import { letterboxFillHex, letterboxInnerRect } from "./letterbox-fill";
import type { WebGLRenderer } from "three";

/** GPU pack mirror: copy primary viewport into an FBO texture, blit into mirror viewports (no readback). */
export class PackMirrorGl {
  private copyFbo: WebGLFramebuffer | null = null;
  private tex: WebGLTexture | null = null;
  private tw = 0;
  private th = 0;

  dispose(gl: WebGL2RenderingContext): void {
    if (this.copyFbo) gl.deleteFramebuffer(this.copyFbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.copyFbo = null;
    this.tex = null;
  }

  ensureTexture(gl: WebGL2RenderingContext, w: number, h: number): void {
    if (w < 2 || h < 2) return;
    if (this.tex && w === this.tw && h === this.th) return;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.copyFbo) gl.deleteFramebuffer(this.copyFbo);
    this.tw = w;
    this.th = h;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.copyFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.copyFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Copy a region from the default framebuffer into the internal texture. */
  captureFromScreen(gl: WebGL2RenderingContext, sx: number, sy: number, sw: number, sh: number): void {
    this.ensureTexture(gl, sw, sh);
    if (!this.copyFbo) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFbo);
    gl.blitFramebuffer(sx, sy, sx + sw, sy + sh, 0, 0, sw, sh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /** Blit captured texture into a letterboxed inner rect on the default framebuffer. */
  blitToViewport(
    gl: WebGL2RenderingContext,
    renderer: WebGLRenderer,
    fill: SurfaceLetterboxFill,
    dst: { x: number; y: number; w: number; h: number },
    pr: number,
    contentAspect: number,
  ): { x: number; y: number; w: number; h: number } {
    const inner = letterboxInnerRect(dst, contentAspect);
    inner.x += dst.x;
    inner.y += dst.y;
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
    renderer.setClearColor(letterboxFillHex(fill), 1);
    renderer.clear(true, false, false);
    if (this.copyFbo && iw > 1 && ih > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.tw, this.th, ix, iy, ix + iw, iy + ih, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    return { x: ix, y: iy, w: iw, h: ih };
  }
}
