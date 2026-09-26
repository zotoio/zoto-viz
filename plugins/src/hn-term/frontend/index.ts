/** Hacker News greenscreen — headlines and RSS blurbs type in, then scroll up. */

import {
  TERM_COLS, TERM_ROWS, packScreen, preferHnStories, scriptFromStories, visibleScreen,
} from "./teletype";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "dt" | "audio" | "headlines">) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

let typed = 0;
let lastT = 0;
let script = scriptFromStories([]);

zoto.onFrame = (frame) => {
  const next = scriptFromStories(preferHnStories(frame.headlines ?? []));
  if (next !== script) {
    script = next;
    typed = Math.min(typed, script.length);
  }
  const now = typeof performance !== "undefined" ? performance.now() / 1000 : frame.t;
  const dt = lastT > 0 ? Math.min(1, Math.max(0, now - lastT)) : 1 / 60;
  lastT = now;
  const cps = 28 + frame.audio * 18;
  typed += dt * cps;
  if (script.length > 0 && typed > script.length + 40) typed = 0;
  const screen = visibleScreen(script, typed, TERM_COLS, TERM_ROWS);
  const blink = Math.floor(frame.t * 2.4) % 2;
  zoto.writeBuffer(0, packScreen(screen, frame.audio, blink));
  zoto.writeUniform("uAccent", [0.35, 1.0, 0.42]);
  zoto.writeUniform("uBg", [0.0, 0.04, 0.01]);
};
