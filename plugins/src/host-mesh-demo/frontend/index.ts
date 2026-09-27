import type { VizDataFrame, VizPresentTick } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();

let t = 0;

function matrixSlot(clock: number): number[] {
  const s = 0.35 + Math.sin(clock * 0.7) * 0.1;
  const c = Math.cos(clock * 0.4);
  const si = Math.sin(clock * 0.4);
  // column-major 4×4: Y spin + uniform scale
  return [
    s * c, 0, s * si, 0,
    0, s, 0, 0,
    -s * si, 0, s * c, 0,
    0, 0, -1.2, 1,
  ];
}

host.onFrame = (frame: VizDataFrame) => {
  t = frame.t;
};

host.onPresent = (tick: VizPresentTick) => {
  const clock = typeof tick.pluginClock === "number" ? tick.pluginClock : t + tick.frameMs * 0.001;
  host.writeBuffer(2, matrixSlot(clock));
  host.writeUniform("uBright", 0.95);
  host.writeUniform("uOpacity", 1);
};
