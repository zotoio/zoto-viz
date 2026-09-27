import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
/** Backrooms sky colours. The host runs `director.ts` on the sky clock and writes slots 0–1 every frame. */


host.onFrame = () => {
  // No buffer writes here: a late iframe write would replace the director's camera with a stale one.
  host.writeUniform("uAccent", [1.0, 0.92, 0.55]);
  host.writeUniform("uBg", [0.1, 0.09, 0.04]);
};
