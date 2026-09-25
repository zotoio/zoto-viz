/** Host idle fixture can drive audio; maze timing stays uTime-locked in GLSL.
 *  Buffer: [phA, audio, peekOn, walkAhead] — walkAhead=1 while facing straight (pre-spot). */

type VizFrame = {
  t: number;
  audio: number;
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
};

zoto.onFrame = (frame) => {
  const rate = 0.04;
  const phA = frame.t * rate - Math.floor(frame.t * rate);
  const cycle = Math.floor(frame.t * rate);
  const hash = (n: number) => {
    const x = Math.sin(n) * 43758.5453123;
    return x - Math.floor(x);
  };
  const peekOn = Math.floor(hash(cycle + 17) * 4) >= 1 ? 1 : 0;
  const peekPh = 0.22 + 0.12 * hash(cycle + 9);
  // 1 while walking straight ahead; 0 once spotted (glance/flee handled in GLSL).
  const walkAhead = peekOn === 0 || phA < peekPh ? 1 : 0;
  zoto.writeBuffer(0, [phA, frame.audio, peekOn, walkAhead]);
};
