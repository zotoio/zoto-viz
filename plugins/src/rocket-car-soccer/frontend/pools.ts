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
  /** Count of `new`/`push` style growth after warm-up — must stay 0. */
  allocsAfterWarm = 0;
  private warmed = false;

  constructor(cap: number) {
    this.cap = cap;
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
    const out: number[] = [];
    for (const s of this.slots) {
      if (!s.active) continue;
      out.push(s.x, s.y, s.z, s.w);
      if (out.length >= this.cap * stride) break;
    }
    return out;
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
