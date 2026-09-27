import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";

let frames = 0;

type LoseCtxHost = ReturnType<typeof getVizZoto> & { loseHostContext: () => void };
const host = getVizZoto() as LoseCtxHost;

host.onFrame = (frame: VizDataFrame) => {
  frames += 1;
  if (frames === 40) host.loseHostContext();
  host.writeUniform("uTime", frame.t);
  host.writeUniform("uBright", 0.85);
  host.writeUniform("uAccent", [0.9, 0.4, 0.2]);
  host.writeUniform("uOpacity", 0.9);
};
