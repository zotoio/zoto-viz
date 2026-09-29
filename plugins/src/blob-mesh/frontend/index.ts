
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
  // Radius follows each talker's share of the peak, scaled up to +0.1 as the peak nears
  // 60 pkt/s. The old rate / 60 capped every talker above ~17 pkt/s at 0.44, and 4+ blobs
  // that size fill the whole dome with one flat iso (a live LAN read as a solid cyan wall).
  // viz-pack-host.ts runPackFrameHandler("blob-mesh") mirrors this writer.
  const buf: number[] = [];
  const n = Math.min(8, frame.talkers.length);
  const peak = frame.talkers.reduce((m, t) => Math.max(m, t.rate), 0);
  const busy = Math.min(1, peak / 60);
  for (let i = 0; i < n; i++) {
    const t = frame.talkers[i]!;
    const h = (t.id.charCodeAt(0) + i * 19) % 97;
    const ang = (h / 97) * 6.283 + frame.t * (0.15 + i * 0.03);
    const r = 0.25 + (h % 20) / 50;
    const share = peak > 0 ? t.rate / peak : 0;
    buf.push(Math.cos(ang) * r, Math.sin(ang) * r, 0.16 + 0.1 * share * busy, roleHue(t.role));
  }
  host.writeBuffer(0, buf);
  host.writeUniform("uBright", 0.8 + Math.min(0.35, (frame.talkers[0]?.rate ?? 0) / 80) + frame.audio * 0.2);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.25, 0.75, 0.95]);
};
