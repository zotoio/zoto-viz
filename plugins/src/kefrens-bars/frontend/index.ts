
/** Kefrens / copper bars — talker rates become bar amplitudes. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();


host.onFrame = (frame) => {
  const buf: number[] = [];
  const n = Math.min(8, frame.talkers.length);
  for (let i = 0; i < n; i++) {
    const t = frame.talkers[i]!;
    buf.push(0.45 + Math.min(0.55, t.rate / 40), (t.id.charCodeAt(0) % 97) / 97, i / 8, 0);
  }
  host.writeBuffer(0, buf);
  const peak = frame.talkers[0]?.rate ?? 0;
  host.writeUniform("uBright", 0.85 + Math.min(0.35, peak / 80) + frame.audio * 0.15);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.95, 0.45 + Math.min(0.4, peak / 400), 0.18]);
};
