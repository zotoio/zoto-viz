
/** Rotozoomer — proto field mix becomes spin and zoom. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";
const host = getVizZoto();


host.onFrame = (frame) => {
  const lead = frame.packets[0]?.field ?? 0;
  const mix = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
  host.writeBuffer(0, [lead, mix, frame.t % 1, frame.audio]);
  host.writeUniform("uBright", 0.85 + mix * 0.25 + frame.audio * 0.15);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.7 + lead * 0.25, 0.95 - mix * 0.4, 0.12 + lead * 0.2]);
};
