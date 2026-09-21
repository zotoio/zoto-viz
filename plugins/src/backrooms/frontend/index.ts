/** Host idle fixture can drive audio; the maze sequence is uTime-locked in GLSL. */

type VizFrame = {
  t: number;
  audio: number;
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
};

zoto.onFrame = (frame) => {
  const phA = frame.t * 0.040 - Math.floor(frame.t * 0.040);
  zoto.writeBuffer(0, [phA, frame.audio, 0, 0]);
};
