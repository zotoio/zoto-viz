/**
 * Non-blocking 16×16 (or N×N) RGBA readback via PIXEL_PACK_BUFFER + fenceSync.
 * Harvest uses clientWaitSync(0) — never blocks the GPU thread.
 */

export class AsyncRgbaPatchProbe {
  readonly bytes: Uint8Array;
  /** performance.now() when bytes were last copied from the PBO, or -1. */
  harvestedAt = -1;
  private readonly size: number;
  private pbo: WebGLBuffer | null = null;
  private sync: WebGLSync | null = null;
  private gl: WebGL2RenderingContext | null = null;

  constructor(size = 16) {
    this.size = size;
    this.bytes = new Uint8Array(4 * size * size);
  }

  get pending(): boolean {
    return this.sync !== null;
  }

  /** Try to finish a pending read without blocking. */
  tryHarvest(gl: WebGL2RenderingContext): boolean {
    if (this.gl !== gl) this.reset(gl);
    if (!this.sync || gl.isContextLost()) return false;
    const wait = gl.clientWaitSync(this.sync, 0, 0);
    if (wait === gl.TIMEOUT_EXPIRED) return false;
    if (wait === gl.WAIT_FAILED) {
      this.clearSync(gl);
      return false;
    }
    const sync = this.sync;
    this.sync = null;
    gl.deleteSync(sync);
    if (!this.pbo) return false;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    if (gl.getError() !== gl.NO_ERROR) return false;
    this.harvestedAt = performance.now();
    return true;
  }

  /**
   * Queue readPixels into the PBO. Returns false when a read is already in flight,
   * the region is invalid, or GL errors.
   */
  issue(gl: WebGL2RenderingContext, x: number, y: number): boolean {
    if (this.gl !== gl) this.reset(gl);
    if (gl.isContextLost()) return false;
    if (this.sync) return false;
    const s = this.size;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w < s || h < s) return false;
    const ix = Math.max(0, Math.min(w - s, Math.floor(x)));
    const iy = Math.max(0, Math.min(h - s, Math.floor(y)));
    if (!this.pbo) {
      this.pbo = gl.createBuffer();
      if (!this.pbo) return false;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.bytes.byteLength, gl.STREAM_READ);
    } else {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    }
    try {
      gl.readPixels(ix, iy, s, s, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    } catch {
      this.clearSync(gl);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return false;
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    if (!this.sync || gl.getError() !== gl.NO_ERROR) {
      this.clearSync(gl);
      return false;
    }
    gl.flush();
    return true;
  }

  reset(gl: WebGL2RenderingContext | null = null): void {
    const old = this.gl;
    if (old && !old.isContextLost()) {
      this.clearSync(old);
      if (this.pbo) old.deleteBuffer(this.pbo);
    }
    this.sync = null;
    this.pbo = null;
    this.gl = gl;
    this.harvestedAt = -1;
  }

  private clearSync(gl: WebGL2RenderingContext): void {
    if (this.sync) {
      gl.deleteSync(this.sync);
      this.sync = null;
    }
  }
}

/** Centre of an N×N patch in framebuffer coordinates (origin bottom-left). */
export function patchOriginFb(
  vp: { x: number; y: number; w: number; h: number },
  patch: number,
): { x: number; y: number; cx: number; cy: number } {
  const cx = vp.x + vp.w / 2;
  const cy = vp.y + vp.h / 2;
  const x = Math.max(0, vp.x + (vp.w - patch) / 2);
  const y = Math.max(0, vp.y + (vp.h - patch) / 2);
  return { x, y, cx, cy };
}
