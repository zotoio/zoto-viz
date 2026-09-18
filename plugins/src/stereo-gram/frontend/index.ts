/** Talker orbs packed as hidden stereogram depth. */

import { packStereoOrbs } from "./orbs";

type VizFrame = {
  t: number;
  audio: number;
  talkers: { id: string; rate: number; role: string }[];
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  zoto.writeBuffer(0, packStereoOrbs(frame.talkers, frame.t));
  zoto.writeUniform("uAccent", [0.95, 0.35, 0.72]);
  zoto.writeUniform("uBg", [0.06, 0.03, 0.1]);
};
