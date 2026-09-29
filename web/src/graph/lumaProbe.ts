import { relativeLuminance } from "../core/themes";
import { AsyncRgbaPatchProbe } from "./async-rgba-patch";
import { TILE_HEALTH_PATCHES, healthPatchOrigins } from "../plugins/tile-health";

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
  /** Tile-health reads: centre + four quadrants, each its own async PBO read. */
  private readonly healthPatches: AsyncRgbaPatchProbe[];
  private readonly healthBytes: Uint8Array;

  constructor(private readonly size = 16, private readonly everyMs = 150) {
    this.patch = new AsyncRgbaPatchProbe(size);
    this.vals = new Array<number>(size * size);
    this.healthPatches = Array.from({ length: TILE_HEALTH_PATCHES }, () => new AsyncRgbaPatchProbe(size));
    this.healthBytes = new Uint8Array(TILE_HEALTH_PATCHES * size * size * 4);
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
   * Tile-health: the five health patches when all are fresh; otherwise queue reads and return null
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
    let fresh = true;
    for (const p of this.healthPatches) {
      p.tryHarvest(gl);
      if (p.harvestedAt < 0 || now - p.harvestedAt > maxStaleMs) fresh = false;
    }
    if (fresh) {
      const chunk = this.size * this.size * 4;
      this.healthPatches.forEach((p, i) => this.healthBytes.set(p.bytes, i * chunk));
      return this.healthBytes;
    }
    const origins = healthPatchOrigins(vp, this.size);
    this.healthPatches.forEach((p, i) => {
      if (!p.pending) p.issue(gl, origins[i]!.x, origins[i]!.y);
    });
    return null;
  }

  private reduce(): void {
    const d = this.patch.bytes;
    const vals = this.vals;
    let n = 0;
    for (let i = 0; i + 2 < d.length; i += 4) {
      vals[n++] = relativeLuminance((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    }
    if (n < 8) return;
    vals.length = n;
    vals.sort((a, b) => a - b);
    this.value = vals[n >> 1]!;
  }

  /** Drop GPU handles (context lost or renderer disposed). */
  reset(): void {
    this.patch.reset(null);
    for (const p of this.healthPatches) p.reset(null);
    this.issuedAt = -Infinity;
    this.value = -1;
  }
}
