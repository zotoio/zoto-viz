/** Host viz contract — do not extend with pack-only fields. */
export type {
  VizDataFrame,
  VizHeadline,
  VizPacketSample,
  VizSysTelemetry,
  VizTalkerSample,
} from "../../../sdk/viz-contract";

import type { VizDataFrame } from "../../../sdk/viz-contract";

/** Fields this pack reads from each delivered frame. */
export type VoxelVizInput = Pick<
  VizDataFrame,
  "t" | "packets" | "talkers" | "demo" | "sys" | "headlines"
>;
