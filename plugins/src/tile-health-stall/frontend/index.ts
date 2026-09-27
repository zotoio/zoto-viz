import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";

let frames = 0;

type StallHost = ReturnType<typeof getVizZoto> & { reportDrawState: (drawing: boolean) => void };
const host = getVizZoto() as StallHost;

host.onFrame = (frame: VizDataFrame) => {
  frames += 1;
  if (frames > 40) {
    host.reportDrawState(false);
    return;
  }
  host.reportDrawState(true);
  host.writeUniform("uTime", frame.t);
  host.writeUniform("uBright", 0.9);
  host.writeUniform("uAccent", [0.2, 0.7, 0.95]);
  host.writeUniform("uOpacity", 0.85);
};
