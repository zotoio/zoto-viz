/** Rotozoomer — proto field mix becomes spin and zoom. */

import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "packets" | "audio">) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  const lead = frame.packets[0]?.field ?? 0;
  const mix = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
  zoto.writeBuffer(0, [lead, mix, frame.t % 1, frame.audio]);
  zoto.writeUniform("uBright", 0.85 + mix * 0.25 + frame.audio * 0.15);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [0.7 + lead * 0.25, 0.95 - mix * 0.4, 0.12 + lead * 0.2]);
};
