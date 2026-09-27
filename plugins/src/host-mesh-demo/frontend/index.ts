import type { VizDataFrame, VizPresentTick } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onPresent: ((tick: VizPresentTick) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number) => void;
};

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

zoto.onFrame = (frame) => {
  t = frame.t;
};

zoto.onPresent = (tick) => {
  const clock = typeof tick.pluginClock === "number" ? tick.pluginClock : t + tick.frameMs * 0.001;
  zoto.writeBuffer(2, matrixSlot(clock));
  zoto.writeUniform("uBright", 0.95);
  zoto.writeUniform("uOpacity", 1);
};
