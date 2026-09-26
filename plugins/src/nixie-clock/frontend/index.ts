/** IN-18 Nixie clock — local time packed into sky slots. */

import { nixieCanvasSize, packNixieBuffer, parseNixieLook, type NixieLook } from "./tubes";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";

const zoto = getVizZoto();

let look: NixieLook = parseNixieLook(zoto.getConfig?.());

zoto.onConfig = (cfg) => {
  look = parseNixieLook(cfg);
};

zoto.onFrame = (frame) => {
  const peak = Math.min(1, (frame.talkers?.[0]?.rate ?? 0) / 180);
  zoto.writeBuffer(0, packNixieBuffer(new Date(), look, frame.audio, peak, nixieCanvasSize()));
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [1.0, 0.38, 0.06]);
  zoto.writeUniform("uBg", [0.06, 0.03, 0.02]);
};
