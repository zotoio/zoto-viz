/** Pre-allocated particle and boost-trail pools (no growth after warm-up). */

export interface PoolSlot {
  x: number;
  y: number;
  z: number;
  w: number;
  active: boolean;
}

export class InstancedPool {
  readonly cap: number;
  readonly slots: PoolSlot[];
  private readonly packScratch: number[];
  /** Count of `new`/`push` style growth after warm-up — must stay 0. */
  allocsAfterWarm = 0;
  private warmed = false;

  constructor(cap: number) {
    this.cap = cap;
    this.packScratch = new Array(cap * 4).fill(0);
    this.slots = new Array(cap);
    for (let i = 0; i < cap; i++) {
      this.slots[i] = { x: 0, y: 0, z: 0, w: 0, active: false };
    }
  }

  warm(): void {
    this.warmed = true;
    this.allocsAfterWarm = 0;
  }

  activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  /** Activate a free slot; returns false if pool is full. */
  emit(x: number, y: number, z: number, w: number): boolean {
    if (!this.warmed) this.warm();
    for (const s of this.slots) {
      if (!s.active) {
        s.x = x;
        s.y = y;
        s.z = z;
        s.w = w;
        s.active = true;
        return true;
      }
    }
    return false;
  }

  tick(dt: number, decay: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.w -= dt * decay;
      if (s.w <= 0.02) s.active = false;
    }
  }

  pack(stride = 4): number[] {
    this.packInto(this.packScratch, stride);
    return this.packScratch;
  }

  /** Write active slots into `out`; sets `out.length` to bytes written (no new array). */
  packInto(out: number[], stride = 4): number {
    let w = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      if (w + stride > out.length) break;
      out[w] = s.x;
      out[w + 1] = s.y;
      out[w + 2] = s.z;
      out[w + 3] = s.w;
      w += stride;
    }
    out.length = w;
    return w;
  }

  burst(count: number, fx: number, fy: number, fz: number, spread: number, rng: () => number): number {
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (this.emit(
        fx + (rng() - 0.5) * spread,
        fy + rng() * spread * 0.5,
        fz + (rng() - 0.5) * spread,
        0.85 + rng() * 0.15,
      )) n++;
    }
    return n;
  }
}
