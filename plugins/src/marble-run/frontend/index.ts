
/** Marble Run — sandbox drives sim + sky buffers (no host-specific hooks). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { parseMarbleOptions } from "./config";
import { disposeMarblePack, ingestFrame, packMarbleSlots, setMarbleOptions } from "./pack";
import { getVizZoto } from "../../../sdk/viz-zoto";
const host = getVizZoto();


let cfg = parseMarbleOptions(host.getConfig?.());
setMarbleOptions(cfg);

host.onConfig = (raw) => {
  cfg = parseMarbleOptions(raw);
  setMarbleOptions(cfg);
};

host.onFrame = (frame: VizDataFrame) => {
  ingestFrame(frame);
  const { slot0, slot1 } = packMarbleSlots(frame);
  host.writeBuffer(0, slot0);
  host.writeBuffer(1, slot1);
  const pulse = 0.75 + frame.audio * 0.2 + (frame.demo ? 0.08 : 0.12);
  host.writeUniform("uBright", pulse);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.72, 0.48, 0.22]);
  host.writeUniform("uBg", [0.07, 0.09, 0.12]);
};

export function marblePackTeardown(): void {
  disposeMarblePack();
}
