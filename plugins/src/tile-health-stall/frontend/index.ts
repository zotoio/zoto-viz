import type { VizDataFrame } from "../../../sdk/viz-contract";

let frames = 0;

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  reportDrawState: (drawing: boolean) => void;
};

zoto.onFrame = (frame) => {
  frames += 1;
  if (frames > 40) {
    zoto.reportDrawState(false);
    return;
  }
  zoto.reportDrawState(true);
  zoto.writeUniform("uTime", frame.t);
  zoto.writeUniform("uBright", 0.9);
  zoto.writeUniform("uAccent", [0.2, 0.7, 0.95]);
  zoto.writeUniform("uOpacity", 0.85);
};
