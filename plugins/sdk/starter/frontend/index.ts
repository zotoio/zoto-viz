/** Pack starter entry — copy to plugins/src/<id>/frontend/index.ts */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import type { VizPackZotoHost } from "../../../sdk/viz-pack-host";
import { VIZ_PACK_TILE_FALLBACK } from "../../../sdk/viz-pack-host";
import { DEFAULT_OPTIONS, parseStarterOptions, type StarterOptions } from "./config";
import { StarterSim } from "./sim";

const zoto = globalThis.zoto as VizPackZotoHost;

type StarterFrame = Pick<VizDataFrame, "t" | "dt" | "audio" | "talkers" | "demo" | "sys">;

let options: StarterOptions = DEFAULT_OPTIONS;
const sim = new StarterSim(options);

zoto.onConfig = (cfg) => {
  options = parseStarterOptions(cfg);
  sim.setOptions(options);
};

zoto.onFrame = (frame: StarterFrame) => {
  const tile = VIZ_PACK_TILE_FALLBACK;
  const packed = sim.advance(frame as VizDataFrame, tile.w, tile.h);
  zoto.writeBuffer(0, packed.slot0);
  zoto.writeUniform("uBright", packed.bright);
  zoto.writeUniform("uAccent", packed.accent);
  zoto.writeUniform("uBg", packed.bg);
  zoto.writeUniform("uOpacity", 0.92);
  void packed.labelMetric;
};
