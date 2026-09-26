import { nixieWallDisplayTimeZone } from "./nixie-wall-timezone";
import { wallPartsFromMs } from "./nixie-wall-clock";

const sharedParts = { h: 0, m: 0, s: 0 };

/** One wall-clock format per second for every nixie tile on the wall. */
export class SharedNixieWallSecond {
  private lastSec = -1;

  reset(): void {
    this.lastSec = -1;
  }

  /** Advance shared wall parts once per new wall second (reuses one parts object). */
  syncWallSecond(wallMs: number, timeZone?: string): { h: number; m: number; s: number } {
    const tz = timeZone ?? nixieWallDisplayTimeZone();
    const sec = Math.floor(wallMs / 1000);
    if (sec !== this.lastSec || this.lastSec < 0) {
      this.lastSec = sec;
      const parts = wallPartsFromMs(wallMs, tz);
      sharedParts.h = parts.h;
      sharedParts.m = parts.m;
      sharedParts.s = parts.s;
    }
    return sharedParts;
  }
}
