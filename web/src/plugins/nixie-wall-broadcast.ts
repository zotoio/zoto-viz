import { vizWallMs } from "../core/viz-clock";
import type { MonoMs } from "../core/viz-time";
import {
  clearDevWallFlagClock,
  devWallFlagClockActive,
  fillDevWallFlagPartsScratch,
  fillRealWallPartsScratch,
  nixieWallPartsScratch,
  wallSecondKeyFromScratch,
} from "./nixie-wall-parts";

/** One wall-clock format per second for every nixie tile on the wall. */
export class SharedNixieWallSecond {
  private lastKey = -1;

  reset(): void {
    this.lastKey = -1;
  }

  /** Fill shared scratch once per new wall second; returns the same object every call. */
  syncWallSecond(frameMono: MonoMs): typeof nixieWallPartsScratch {
    if (devWallFlagClockActive()) fillDevWallFlagPartsScratch(frameMono);
    else fillRealWallPartsScratch(vizWallMs());
    const key = wallSecondKeyFromScratch();
    if (key !== this.lastKey || this.lastKey < 0) this.lastKey = key;
    return nixieWallPartsScratch;
  }
}

export { clearDevWallFlagClock, nixieWallPartsScratch };
