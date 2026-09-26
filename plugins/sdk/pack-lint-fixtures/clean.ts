import type { VizDataFrame } from "../../sdk/viz-contract";
import type { VizPackZotoHost } from "../../sdk/viz-pack-host";

const zoto = globalThis.zoto as VizPackZotoHost;

let cfg: Record<string, string> = {};

zoto.onConfig = (next) => {
  cfg = next;
};

zoto.onFrame = (frame: VizDataFrame) => {
  void frame;
  void cfg;
};
