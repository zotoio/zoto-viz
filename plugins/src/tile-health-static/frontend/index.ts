import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();

host.onFrame = () => {
  host.writeUniform("uTime", 0);
  host.writeUniform("uBright", 1);
  host.writeUniform("uAccent", [0.2, 0.5, 0.8]);
  host.writeUniform("uOpacity", 1);
};
