import type { VizDataFrame } from "../../sdk/viz-contract";
import { getVizZoto } from "../../sdk/viz-zoto";

const host = getVizZoto();

let cfg: Record<string, string> = {};

host.onConfig = (next) => {
  cfg = next;
};

host.onFrame = (frame: VizDataFrame) => {
  void frame;
  void cfg;
};
