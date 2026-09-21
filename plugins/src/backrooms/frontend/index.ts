/** Host idle fixture drives audio; sky sequence is uTime-locked in GLSL. */

type VizFrame = {
  t: number;
  audio: number;
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  const phA = frame.t * 0.040 - Math.floor(frame.t * 0.040);
  zoto.writeBuffer(0, [phA, frame.audio, 0, 0]);
  zoto.writeUniform("uAccent", [0.92, 0.86, 0.38]);
  zoto.writeUniform("uBg", [0.08, 0.07, 0.04]);
  zoto.writeUniform("uBright", 1.05);
  zoto.writeUniform("uOpacity", 1);
};
