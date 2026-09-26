
/** Sine-scroll starfield — packet fields drive lanes; extra slots morph pareidolia faces. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";
const zoto = getVizZoto();


zoto.onFrame = (frame) => {
  const lead = frame.packets[0]?.field ?? 0;
  const depth = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
  const t = frame.t;
  const seed = lead * 2.1 + depth * 1.3;
  const morph = 0.5 + 0.5 * Math.sin(t * 0.31 + lead * 4.0);
  const smile = 0.5 + 0.5 * Math.sin(t * 0.47 + depth * 3.0);
  const gaze = Math.sin(t * 0.55 + lead);
  const canvas = document.querySelector("canvas");
  const rw = canvas?.width || 1280;
  const rh = canvas?.height || 800;
  zoto.writeBuffer(0, [lead, depth, frame.packets.length / 32, frame.audio, seed, morph, smile, gaze, rw, rh]);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [0.75, 0.85, 1.0]);
};
