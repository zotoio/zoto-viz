
/** Metaball field — each talker is a blob (xy, radius, hue). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();


function roleHue(role: string): number {
  if (role === "gateway") return 0.08;
  if (role === "internet") return 0.78;
  if (role === "lan") return 0.45;
  return 0.22;
}

host.onFrame = (frame) => {
  const buf: number[] = [];
  const n = Math.min(8, frame.talkers.length);
  for (let i = 0; i < n; i++) {
    const t = frame.talkers[i]!;
    const h = (t.id.charCodeAt(0) + i * 19) % 97;
    const ang = (h / 97) * 6.283 + frame.t * (0.15 + i * 0.03);
    const r = 0.25 + (h % 20) / 50;
    buf.push(Math.cos(ang) * r, Math.sin(ang) * r, 0.16 + Math.min(0.28, t.rate / 60), roleHue(t.role));
  }
  host.writeBuffer(0, buf);
  const peak = frame.talkers[0]?.rate ?? 0;
  host.writeUniform("uBright", 0.8 + Math.min(0.35, peak / 80) + frame.audio * 0.2);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.25, 0.75, 0.95]);
};
