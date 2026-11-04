/**
 * Small, testable pieces of the render host's frame loop hardening:
 *  - ViewErrorBudget: one throwing view must not take down (or flood) the whole wall,
 *  - FrameGate: optional fps cap for the wall,
 *  - ContextLossLimiter: repeated GPU context loss trips a quality fallback.
 */

export class ViewErrorBudget<V extends object> {
  private readonly streak = new WeakMap<V, number>();
  private readonly off = new Set<V>();

  constructor(
    private budget: number,
    private readonly onDisable: (view: V, err: unknown, streak: number) => void,
    private readonly onError: (view: V, err: unknown, streak: number) => void = () => undefined,
  ) {}

  setBudget(n: number): void { this.budget = Math.max(1, n); }
  isDisabled(view: V): boolean { return this.off.has(view); }
  get disabledCount(): number { return this.off.size; }

  /** Run one frame of `view`; returns false when it is (now) disabled. */
  run(view: V, frame: () => void): boolean {
    if (this.off.has(view)) return false;
    try {
      frame();
      if (this.streak.has(view)) this.streak.delete(view);
      return true;
    } catch (err) {
      const n = (this.streak.get(view) ?? 0) + 1;
      this.streak.set(view, n);
      // log the first throw of a streak, not one per frame
      if (n === 1) this.onError(view, err, n);
      if (n >= this.budget) {
        this.off.add(view);
        this.onDisable(view, err, n);
        return false;
      }
      return true;
    }
  }

  /** Give a disabled view another chance (context restored, view rebuilt, user retry). */
  reenable(view?: V): void {
    if (view) { this.off.delete(view); this.streak.delete(view); return; }
    this.off.clear();
  }

  forget(view: V): void { this.off.delete(view); this.streak.delete(view); }
}

export class FrameGate {
  private last = -Infinity;
  constructor(public fpsCap = 0) {}

  /** True when a frame at `ts` (ms) should draw under the cap. */
  shouldDraw(ts: number): boolean {
    if (!(this.fpsCap > 0)) { this.last = ts; return true; }
    const interval = 1000 / this.fpsCap;
    // 1 ms tolerance so a 60 Hz display with a 30 fps cap draws every other frame, not every third
    if (ts - this.last >= interval - 1) {
      this.last = this.last === -Infinity || ts - this.last > interval * 2 ? ts : this.last + interval;
      return true;
    }
    return false;
  }
}

export class ContextLossLimiter {
  private times: number[] = [];
  private tripped = false;
  constructor(public limit: number, public windowMs: number) {}

  /** Record a loss at `now`; true exactly once, when the limit is first reached. */
  note(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    this.times.push(now);
    if (!this.tripped && this.times.length >= this.limit) {
      this.tripped = true;
      return true;
    }
    return false;
  }

  get isTripped(): boolean { return this.tripped; }
  get recent(): number { return this.times.length; }
}
