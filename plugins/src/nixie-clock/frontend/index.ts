/** IN-18 Nixie clock — local time packed into sky slots. */

import { nixieCanvasSize, packNixieBuffer, parseNixieLook, type NixieLook } from "./tubes";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "audio" | "talkers">) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

let look: NixieLook = parseNixieLook(zoto.getConfig?.());

zoto.onConfig = (cfg) => {
  look = parseNixieLook(cfg);
};

zoto.onFrame = (frame) => {
  const peak = Math.min(1, (frame.talkers?.[0]?.rate ?? 0) / 180);
  const wallMs = typeof frame.t === "number" && frame.t > 1e8 ? frame.t * 1000 : Date.now();
  zoto.writeBuffer(0, packNixieBuffer(new Date(wallMs), look, frame.audio, peak, nixieCanvasSize()));
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [1.0, 0.38, 0.06]);
  zoto.writeUniform("uBg", [0.06, 0.03, 0.02]);
};
