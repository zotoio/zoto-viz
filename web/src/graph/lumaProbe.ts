import { relativeLuminance } from "../core/themes";
import { bindDefaultFramebufferForRead } from "./pane-change";

/**
 * Non-blocking probe of the framebuffer's luminance behind the labels.
 *
 * `gl.readPixels` into client memory forces the GPU pipeline to drain on the spot — on a busy or
 * power-capped GPU that was most of a frame. Here the read goes into a pixel-pack buffer, a fence is
 * placed behind it, and the bytes are only copied out on a later frame once the fence reports the GPU
 * is done. The value lags by a frame or two, which is invisible for ink contrast.
 */
export class LumaProbe {
  /** median WCAG relative luminance of the last completed probe, or -1 before the first one */
  value = -1;
  private pbo: WebGLBuffer | null = null;
  private sync: WebGLSync | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private readonly pix: Uint8Array;
  private readonly vals: number[];
  private issuedAt = -Infinity;

  constructor(private readonly size = 16, private readonly everyMs = 150) {
    this.pix = new Uint8Array(4 * size * size);
    this.vals = new Array<number>(size * size);
  }

  /**
   * Call right after the scene has been drawn to the default framebuffer. Harvests a finished probe
   * if one is pending, then issues a new one when the interval has elapsed. Never waits on the GPU.
   * `cx, cy` are the centre of the patch in framebuffer pixels (origin bottom-left).
   */
  tick(gl: WebGL2RenderingContext, cx: number, cy: number, now = performance.now()): void {
    if (this.gl !== gl) this.reset(gl);
    if (gl.isContextLost()) return;
    if (this.sync) {
      const st = gl.getSyncParameter(this.sync, gl.SYNC_STATUS);
      if (st !== gl.SIGNALED) return; // still in flight; try again next frame
      gl.deleteSync(this.sync);
      this.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pix);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.reduce();
    }
    if (now - this.issuedAt < this.everyMs) return;
    const s = this.size;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w < s || h < s) return;
    const x = Math.max(0, Math.min(w - s, Math.round(cx - s / 2)));
    const y = Math.max(0, Math.min(h - s, Math.round(cy - s / 2)));
    this.issuedAt = now;
    if (!this.pbo) {
      this.pbo = gl.createBuffer();
      if (!this.pbo) return;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pix.byteLength, gl.STREAM_READ);
    } else {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    }
    try {
      bindDefaultFramebufferForRead(gl);
      gl.readPixels(x, y, s, s, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    } catch {
      this.sync = null;
    } finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    gl.flush();
  }

  /** Drop GPU handles (context lost or renderer disposed). */
  reset(gl: WebGL2RenderingContext | null = null): void {
    const old = this.gl;
    if (old && !old.isContextLost()) {
      if (this.sync) old.deleteSync(this.sync);
      if (this.pbo) old.deleteBuffer(this.pbo);
    }
    this.sync = null;
    this.pbo = null;
    this.gl = gl;
    this.issuedAt = -Infinity;
  }

  private reduce(): void {
    const d = this.pix, vals = this.vals;
    let n = 0;
    for (let i = 0; i + 2 < d.length; i += 4) {
      vals[n++] = relativeLuminance((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    }
    if (n < 8) return;
    vals.length = n;
    vals.sort((a, b) => a - b);
    this.value = vals[n >> 1]!;
  }
}
