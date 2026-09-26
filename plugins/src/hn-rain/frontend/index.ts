
/** Phosphor rain — HN / host source headlines become the glyph stream. */

import { hnRainCanvasSize, packHnRainBuffer, parseHnRainLook, type HnRainLook } from "./crawl";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";
const host = getVizZoto();


let look: HnRainLook = parseHnRainLook(host.getConfig?.());

host.onConfig = (cfg) => {
  look = parseHnRainLook(cfg);
};

host.onFrame = (frame) => {
  const titles = frame.headlines ?? [];
  const field = frame.packets[0]?.field ?? 0;
  host.writeBuffer(0, packHnRainBuffer(titles, field, frame.audio, look, hnRainCanvasSize()));
  host.writeUniform("uBright", 0.92 + Math.min(0.2, titles.length * 0.02) + frame.audio * 0.18);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.35, 1.0, 0.42]);
};
