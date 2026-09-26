declare const zoto: {
  onFrame: ((frame: { t: number }) => void) | null;
  writeUniform: (name: string, value: number) => void;
};

zoto.onFrame = (frame) => {
  zoto.writeUniform("uTime", frame.t);
  zoto.writeUniform("uBright", 1);
  zoto.writeUniform("uOpacity", 1);
};
