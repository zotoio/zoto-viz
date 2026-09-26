import { wallPartsFromMs } from "./nixie-wall-clock";

/** One wall-clock format per second for every nixie tile on the wall. */
export class SharedNixieWallSecond {
  private lastSec = -1;
  private cachedH = 0;
  private cachedM = 0;
  private cachedS = 0;

  reset(): void {
    this.lastSec = -1;
  }

  /** Advance shared wall parts once per new wall second. */
  syncWallSecond(wallMs: number, timeZone?: string): { h: number; m: number; s: number } {
    const sec = Math.floor(wallMs / 1000);
    if (sec !== this.lastSec || this.lastSec < 0) {
      this.lastSec = sec;
      const parts = wallPartsFromMs(wallMs, timeZone);
      this.cachedH = parts.h;
      this.cachedM = parts.m;
      this.cachedS = parts.s;
    }
    return { h: this.cachedH, m: this.cachedM, s: this.cachedS };
  }
}
