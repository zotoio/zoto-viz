/** Hacker News greenscreen — headlines and RSS blurbs type in, then scroll up. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { HnTermFrameDriver } from "./frame";

const host = getVizZoto();
const driver = new HnTermFrameDriver();

host.onFrame = (frame: VizDataFrame) => {
  const buf = driver.onFrame(frame);
  host.writeBuffer(0, buf);
  host.writeUniform("uAccent", [0.35, 1.0, 0.42]);
  host.writeUniform("uBg", [0.0, 0.04, 0.01]);
};
