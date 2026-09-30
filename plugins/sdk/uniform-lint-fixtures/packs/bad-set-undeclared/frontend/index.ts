import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
host.onFrame = (frame) => {
  host.writeUniform("uBright", 0.8);
  // uGlow is bound to nothing: the sky doesn't declare it and the host preamble doesn't either.
  host.writeUniform("uGlow", frame.audio);
};
