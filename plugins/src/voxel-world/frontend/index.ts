/** Voxel World — host runs `world.ts` on the sky clock and writes slots 0–1 each frame. */

declare const zoto: {
  onFrame: (() => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = () => {
  zoto.writeUniform("uAccent", [0.42, 0.78, 0.38]);
  zoto.writeUniform("uBg", [0.45, 0.62, 0.92]);
  zoto.writeUniform("uBright", 1.05);
};
