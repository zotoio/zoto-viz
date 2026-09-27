import type { VizDataFrame } from "../../../sdk/viz-contract";

/** Narrow frame type for starter handlers — copy into new packs. */
export type StarterVizFrame = Pick<
  VizDataFrame,
  "t" | "dt" | "audio" | "talkers" | "demo" | "sys"
>;

export function asStarterFrame(frame: VizDataFrame): StarterVizFrame {
  return frame;
}
