import type { VizDataFrame } from "../../../sdk/viz-contract";

let frames = 0;

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  loseHostContext: () => void;
};

zoto.onFrame = (frame) => {
  frames += 1;
  if (frames === 40) zoto.loseHostContext();
  zoto.writeUniform("uTime", frame.t);
  zoto.writeUniform("uBright", 0.85);
  zoto.writeUniform("uAccent", [0.9, 0.4, 0.2]);
  zoto.writeUniform("uOpacity", 0.9);
};
