/** Kefrens / copper bars — talker rates become bar amplitudes. */

import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "talkers" | "audio">) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  const buf: number[] = [];
  const n = Math.min(8, frame.talkers.length);
  for (let i = 0; i < n; i++) {
    const t = frame.talkers[i]!;
    buf.push(0.45 + Math.min(0.55, t.rate / 40), (t.id.charCodeAt(0) % 97) / 97, i / 8, 0);
  }
  zoto.writeBuffer(0, buf);
  const peak = frame.talkers[0]?.rate ?? 0;
  zoto.writeUniform("uBright", 0.85 + Math.min(0.35, peak / 80) + frame.audio * 0.15);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [0.95, 0.45 + Math.min(0.4, peak / 400), 0.18]);
};
