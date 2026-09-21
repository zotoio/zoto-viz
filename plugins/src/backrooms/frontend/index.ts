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
  const cycle = Math.floor(frame.t * 0.040);
  const hash = (n: number) => {
    const x = Math.sin(n) * 43758.5453123;
    return x - Math.floor(x);
  };
  const peekOn = hash(cycle + 17) > 0.68 ? 1 : 0;
  zoto.writeBuffer(0, [phA, frame.audio, peekOn, 0]);
};
