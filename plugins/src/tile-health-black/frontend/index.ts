import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();

host.onFrame = (frame: VizDataFrame) => {
  host.writeUniform("uTime", frame.t);
  host.writeUniform("uBright", 1);
  host.writeUniform("uOpacity", 1);
};
