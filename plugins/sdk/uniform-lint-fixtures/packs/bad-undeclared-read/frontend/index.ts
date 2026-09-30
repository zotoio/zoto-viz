import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
host.onFrame = (frame) => {
  host.writeUniform("uBright", 0.8 + frame.audio * 0.2);
};
