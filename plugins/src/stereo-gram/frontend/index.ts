import { getVizZoto } from "../../../sdk/viz-zoto";

const zoto = getVizZoto();
/** Accent colours for the stereogram sky. The host writes the drive buffer. */


zoto.onFrame = () => {
  // The host writes the drive buffer every frame (clock, pulse, spectrum).
  // A late iframe write would replace that with a stale clock.
  zoto.writeUniform("uAccent", [0.95, 0.35, 0.72]);
  zoto.writeUniform("uBg", [0.06, 0.03, 0.1]);
};
