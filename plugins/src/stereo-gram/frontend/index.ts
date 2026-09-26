import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();
/** Accent colours for the stereogram sky. The host writes the drive buffer. */


host.onFrame = () => {
  // The host writes the drive buffer every frame (clock, pulse, spectrum).
  // A late iframe write would replace that with a stale clock.
  host.writeUniform("uAccent", [0.95, 0.35, 0.72]);
  host.writeUniform("uBg", [0.06, 0.03, 0.1]);
};
