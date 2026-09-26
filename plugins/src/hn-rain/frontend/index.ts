/** Phosphor rain — HN / host source headlines become the glyph stream. */

import { hnRainCanvasSize, packHnRainBuffer, parseHnRainLook, type HnRainLook } from "./crawl";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "audio" | "packets" | "headlines">) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

let look: HnRainLook = parseHnRainLook(zoto.getConfig?.());

zoto.onConfig = (cfg) => {
  look = parseHnRainLook(cfg);
};

zoto.onFrame = (frame) => {
  const titles = frame.headlines ?? [];
  const field = frame.packets[0]?.field ?? 0;
  zoto.writeBuffer(0, packHnRainBuffer(titles, field, frame.audio, look, hnRainCanvasSize()));
  zoto.writeUniform("uBright", 0.92 + Math.min(0.2, titles.length * 0.02) + frame.audio * 0.18);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [0.35, 1.0, 0.42]);
};
