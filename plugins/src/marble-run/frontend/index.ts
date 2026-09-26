/** Marble Run — sandbox drives sim + sky buffers (no host-specific hooks). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { parseMarbleOptions } from "./config";
import { disposeMarblePack, ingestFrame, packMarbleSlots, setMarbleOptions } from "./pack";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

let cfg = parseMarbleOptions(zoto.getConfig?.());
setMarbleOptions(cfg);

zoto.onConfig = (raw) => {
  cfg = parseMarbleOptions(raw);
  setMarbleOptions(cfg);
};

zoto.onFrame = (frame: VizDataFrame) => {
  ingestFrame(frame);
  const { slot0, slot1 } = packMarbleSlots(frame);
  zoto.writeBuffer(0, slot0);
  zoto.writeBuffer(1, slot1);
  const pulse = 0.75 + frame.audio * 0.2 + (frame.demo ? 0.08 : 0.12);
  zoto.writeUniform("uBright", pulse);
  zoto.writeUniform("uOpacity", 1);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [0.72, 0.48, 0.22]);
  zoto.writeUniform("uBg", [0.07, 0.09, 0.12]);
};

export function marblePackTeardown(): void {
  disposeMarblePack();
}
