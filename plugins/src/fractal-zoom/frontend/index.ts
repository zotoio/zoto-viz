/** Fractal zoom — colours only; host runs `drive.ts` on the sky clock for stable camera buffers. */

declare const zoto: {
  onFrame: (() => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = () => {
  zoto.writeUniform("uAccent", [0.45, 0.72, 1.0]);
  zoto.writeUniform("uBg", [0.02, 0.04, 0.09]);
  zoto.writeUniform("uBright", 1.05);
  zoto.writeUniform("uOpacity", 1);
};
