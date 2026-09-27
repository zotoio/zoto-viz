/** IN-18 Nixie clock — local time packed into sky slots. */

import { packNixieBuffer, parseNixieLook, type NixieLook } from "./tubes";
import type { VizDataFrame, VizZotoPluginHooks } from "../../../sdk/viz-contract";
void (null as VizZotoPluginHooks | null);
import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();

let look: NixieLook = parseNixieLook(host.getConfig?.());

host.onConfig = (cfg) => {
  look = parseNixieLook(cfg);
};

function hostPackWritesBuffer(): boolean {
  try {
    return typeof parent !== "undefined" && parent !== window;
  } catch {
    return false;
  }
}

host.onFrame = (frame) => {
  const peak = Math.min(1, (frame.talkers?.[0]?.rate ?? 0) / 180);
  if (!hostPackWritesBuffer()) {
    const wallMs = typeof frame.t === "number" && frame.t > 1e8 ? frame.t * 1000 : 0;
    host.writeBuffer(0, packNixieBuffer(new Date(wallMs), look, frame.audio, peak, nixieCanvasSize()));
  }
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [1.0, 0.38, 0.06]);
  host.writeUniform("uBg", [0.06, 0.03, 0.02]);
};
