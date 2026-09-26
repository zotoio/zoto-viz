import type { VizDataFrame } from "../../sdk/viz-contract";
import type { VizZoto } from "../../sdk/viz-zoto";

const zoto = globalThis.zoto as VizZoto;

let cfg: Record<string, string> = {};

zoto.onConfig = (next) => {
  cfg = next;
};

zoto.onFrame = (frame: VizDataFrame) => {
  void frame;
  void cfg;
};
