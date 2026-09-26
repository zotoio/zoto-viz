import { relativeLuminance } from "../core/themes";
import { AsyncRgbaPatchProbe, patchOriginFb } from "./async-rgba-patch";

/**
 * Non-blocking probe of the framebuffer's luminance behind the labels.
 * Shares the same async 16×16 RGBA readback as tile-health empty detection.
 */
export class LumaProbe {
  /** median WCAG relative luminance of the last completed probe, or -1 before the first one */
  value = -1;
  private readonly patch: AsyncRgbaPatchProbe;
  private readonly vals: number[];
  private issuedAt = -Infinity;

  constructor(private readonly size = 16, private readonly everyMs = 150) {
    this.patch = new AsyncRgbaPatchProbe(size);
    this.vals = new Array<number>(size * size);
  }

  /** Last harvested RGBA bytes (same buffer tile-health uses for contrast). */
  rgbaBytes(): Readonly<Uint8Array> {
    return this.patch.bytes;
  }

  lastHarvestAt(): number {
    return this.patch.harvestedAt;
  }

  /**
   * Call right after the scene has been drawn to the default framebuffer. Harvests a finished probe
   * if one is pending, then issues a new one when the interval has elapsed. Never waits on the GPU.
   */
  tick(gl: WebGL2RenderingContext, cx: number, cy: number, now = performance.now()): void {
    if (gl.isContextLost()) {
      this.reset();
      return;
    }
    this.patch.tryHarvest(gl);
    if (this.patch.harvestedAt >= 0) this.reduce();
    if (now - this.issuedAt < this.everyMs) return;
    const s = this.size;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w < s || h < s) return;
    const x = Math.max(0, Math.min(w - s, Math.round(cx - s / 2)));
    const y = Math.max(0, Math.min(h - s, Math.round(cy - s / 2)));
    if (this.patch.issue(gl, x, y)) {
      this.issuedAt = now;
      this.patch.tryHarvest(gl);
      if (this.patch.harvestedAt >= 0) this.reduce();
    }
  }

  /**
   * Tile-health: reuse the luma probe patch when fresh; otherwise queue a read and return null
   * (skip empty classification this cycle — does not count as empty).
   */
  sampleForHealth(
    gl: WebGL2RenderingContext,
    vp: { x: number; y: number; w: number; h: number },
    now = performance.now(),
    maxStaleMs = 3000,
  ): Uint8Array | null {
    if (gl.isContextLost()) {
      this.reset();
      return null;
    }
    this.patch.tryHarvest(gl);
    if (this.patch.harvestedAt >= 0 && now - this.patch.harvestedAt <= maxStaleMs) {
      return this.patch.bytes;
    }
    const { x, y } = patchOriginFb(vp, this.size);
    if (!this.patch.pending) this.patch.issue(gl, x, y);
    return null;
  }

  /** Drop GPU handles (context lost or renderer disposed). */
  reset(): void {
    this.patch.reset(null);
    this.issuedAt = -Infinity;
    this.value = -1;
  }
}
