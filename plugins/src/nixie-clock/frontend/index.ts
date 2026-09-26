/** IN-18 Nixie clock — local time packed into sky slots. */

import { nixieCanvasSize, packNixieBuffer, parseNixieLook, type NixieLook } from "./tubes";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

let look: NixieLook = parseNixieLook(host.getConfig?.());

host.onConfig = (cfg) => {
  look = parseNixieLook(cfg);
};

host.onFrame = (frame) => {
  const peak = Math.min(1, (frame.talkers?.[0]?.rate ?? 0) / 180);
  host.writeBuffer(0, packNixieBuffer(new Date(), look, frame.audio, peak, nixieCanvasSize()));
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [1.0, 0.38, 0.06]);
  host.writeUniform("uBg", [0.06, 0.03, 0.02]);
};
