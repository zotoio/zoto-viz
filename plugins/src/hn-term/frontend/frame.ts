import type { VizDataFrame } from "../../../sdk/viz-contract";
import {
  TERM_COLS,
  TERM_ROWS,
  packScreen,
  preferHnStories,
  scriptFromStories,
  visibleScreen,
} from "./teletype";

/** Sim seconds for hn-term typing — always host `frame.t`, never wall clock. */
export function hnTermFrameSeconds(frame: VizDataFrame): number {
  return frame.t;
}

/** Delta between consecutive `frame.t` samples (`lastT` starts as NaN). */
export function hnTermDeltaSeconds(lastT: number, now: number): number {
  if (!Number.isFinite(lastT)) return 1 / 60;
  const raw = now - lastT;
  if (!Number.isFinite(raw) || raw < 0) return 1 / 60;
  if (raw === 0) return 0;
  return Math.min(1, raw);
}

export class HnTermFrameDriver {
  typed = 0;
  lastT = NaN;
  script = scriptFromStories([]);

  onFrame(frame: VizDataFrame): number[] {
    const next = scriptFromStories(preferHnStories(frame.headlines ?? []));
    if (next !== this.script) {
      this.script = next;
      this.typed = Math.min(this.typed, this.script.length);
    }
    const now = hnTermFrameSeconds(frame);
    const dt = hnTermDeltaSeconds(this.lastT, now);
    this.lastT = now;
    const cps = 28 + frame.audio * 18;
    this.typed += dt * cps;
    if (this.script.length > 0 && this.typed > this.script.length + 40) this.typed = 0;
    const screen = visibleScreen(this.script, this.typed, TERM_COLS, TERM_ROWS);
    const blink = Math.floor(frame.t * 2.4) % 2;
    return packScreen(screen, frame.audio, blink);
  }
}
