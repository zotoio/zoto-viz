import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  writeUniform: (name: string, value: number) => void;
};

zoto.onFrame = (frame) => {
  zoto.writeUniform("uTime", frame.t);
  zoto.writeUniform("uBright", 1);
  zoto.writeUniform("uOpacity", 1);
};
