/** Accent colours for the stereogram sky. The host writes the drive buffer. */

declare const zoto: {
  onFrame: (() => void) | null;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = () => {
  // The host writes the drive buffer every frame (clock, pulse, spectrum).
  // A late iframe write would replace that with a stale clock.
  zoto.writeUniform("uAccent", [0.95, 0.35, 0.72]);
  zoto.writeUniform("uBg", [0.06, 0.03, 0.1]);
};
