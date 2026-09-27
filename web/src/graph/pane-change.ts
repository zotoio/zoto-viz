/**
 * Did this pane's picture change?
 *
 * The badge must not count display refreshes. A pane counts a frame only when a
 * fresh sample of its own pixels differs from the previous sample. The WebGL
 * path reads through a pixel-pack buffer and a fence so the check does not
 * drain the GPU on the spot.
 */

export function bytesDiffer(prev: Uint8Array, next: ArrayLike<number>): boolean {
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) if (prev[i] !== next[i]) return true;
  return false;
}

const PATCH = 16;

export class CanvasChangeProbe {
  private prev: Uint8Array | null = null;

  /** True when the patch differs from the last sample. The first sample only arms the probe. */
  sample(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    rect?: { x: number; y: number; w: number; h: number } | null,
  ): boolean {
    if (canvas.width < 2 || canvas.height < 2) return false;
    const s = Math.min(PATCH, canvas.width, canvas.height, rect ? Math.floor(rect.w) : PATCH, rect ? Math.floor(rect.h) : PATCH);
    if (s < 2) return false;
    const cx = rect ? rect.x + rect.w / 2 : canvas.width / 2;
    const cy = rect ? rect.y + rect.h / 2 : canvas.height / 2;
    const x = Math.max(0, Math.min(canvas.width - s, Math.round(cx - s / 2)));
    const y = Math.max(0, Math.min(canvas.height - s, Math.round(cy - s / 2)));
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(x, y, s, s).data;
    } catch {
      return false;
    }
    const prev = this.prev;
    const changed = !!prev && prev.length === data.length && bytesDiffer(prev, data);
    if (!prev || prev.length !== data.length) this.prev = new Uint8Array(data.length);
    this.prev!.set(data);
    return changed;
  }
}

export interface ProbeRect { x: number; y: number; w: number; h: number }

/**
 * Three full-width rows and three full-height columns through the pane, in
 * framebuffer pixels. Lines see motion anywhere in the pane; a centre patch
 * misses most of it.
 */
export function probeLines(vp: ProbeRect, bufW: number, bufH: number): ProbeRect[] {
  const x0 = Math.max(0, Math.floor(vp.x));
  const y0 = Math.max(0, Math.floor(vp.y));
  const x1 = Math.min(bufW, Math.floor(vp.x + vp.w));
  const y1 = Math.min(bufH, Math.floor(vp.y + vp.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return [];
  const out: ProbeRect[] = [];
  for (const f of [1 / 6, 1 / 2, 5 / 6]) {
    out.push({ x: x0, y: y0 + Math.min(h - 1, Math.floor(h * f)), w, h: 1 });
    out.push({ x: x0 + Math.min(w - 1, Math.floor(w * f)), y: y0, w: 1, h });
  }
  return out;
}

const RING = 3;

interface ReadSlot {
  pbo: WebGLBuffer;
  cap: number;
  bytes: number;
  sync: WebGLSync | null;
  ts: number;
}

export class PaneChangeProbe {
  private gl: WebGL2RenderingContext | null = null;
  private free: ReadSlot[] = [];
  private inFlight: ReadSlot[] = [];
  private made = 0;
  private buf = new Uint8Array(0);
  private prev: Uint8Array | null = null;

  /**
   * Harvest finished reads oldest first, then queue a read of `vp` (framebuffer
   * pixels, origin bottom-left). `onChange` gets the draw time of every sample
   * that differs from the sample before it. A ring of reads lets it sample every
   * frame without waiting on the GPU.
   */
  tick(gl: WebGL2RenderingContext, vp: ProbeRect, ts: number, onChange: (ts: number) => void): void {
    if (this.gl !== gl) this.reset(gl);
    if (gl.isContextLost()) return;
    while (this.inFlight.length) {
      const s = this.inFlight[0]!;
      if (gl.getSyncParameter(s.sync!, gl.SYNC_STATUS) !== gl.SIGNALED) break;
      this.inFlight.shift();
      gl.deleteSync(s.sync!);
      s.sync = null;
      if (this.buf.length < s.bytes) this.buf = new Uint8Array(s.bytes);
      const view = this.buf.subarray(0, s.bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, view);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const prev = this.prev;
      if (prev && prev.length === s.bytes && bytesDiffer(prev, view)) onChange(s.ts);
      if (!prev || prev.length !== s.bytes) this.prev = new Uint8Array(s.bytes);
      this.prev!.set(view);
      this.free.push(s);
    }
    const lines = probeLines(vp, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (!lines.length) return;
    let bytes = 0;
    for (const l of lines) bytes += l.w * l.h * 4;
    const slot = this.takeSlot(gl);
    if (!slot) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
    if (slot.cap < bytes) {
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
      slot.cap = bytes;
    }
    try {
      let off = 0;
      for (const l of lines) {
        gl.readPixels(l.x, l.y, l.w, l.h, gl.RGBA, gl.UNSIGNED_BYTE, off);
        off += l.w * l.h * 4;
      }
      slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    } catch {
      slot.sync = null;
    } finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    if (!slot.sync) {
      this.free.push(slot);
      return;
    }
    slot.bytes = bytes;
    slot.ts = ts;
    this.inFlight.push(slot);
  }

  reset(gl: WebGL2RenderingContext | null = null): void {
    const old = this.gl;
    if (old && !old.isContextLost()) {
      for (const s of [...this.free, ...this.inFlight]) {
        if (s.sync) old.deleteSync(s.sync);
        old.deleteBuffer(s.pbo);
      }
    }
    this.free = [];
    this.inFlight = [];
    this.made = 0;
    this.gl = gl;
    this.prev = null;
  }

  private takeSlot(gl: WebGL2RenderingContext): ReadSlot | null {
    const s = this.free.pop();
    if (s) return s;
    if (this.made >= RING) return null;
    const pbo = gl.createBuffer();
    if (!pbo) return null;
    this.made++;
    return { pbo, cap: 0, bytes: 0, sync: null, ts: 0 };
  }
}
