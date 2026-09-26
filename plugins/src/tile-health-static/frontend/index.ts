declare const zoto: {
  onFrame: ((frame: { t: number }) => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = () => {
  zoto.writeUniform("uTime", 0);
  zoto.writeUniform("uBright", 1);
  zoto.writeUniform("uAccent", [0.2, 0.5, 0.8]);
  zoto.writeUniform("uOpacity", 1);
};
