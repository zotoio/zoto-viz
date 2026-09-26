declare const zoto: {
  onFrame: ((frame: { t: number }) => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  zoto.writeUniform("uTime", frame.t);
  zoto.writeUniform("uBright", 1);
  zoto.writeUniform("uAccent", [0.15, 0.35, 0.85]);
  zoto.writeUniform("uOpacity", 1);
};
