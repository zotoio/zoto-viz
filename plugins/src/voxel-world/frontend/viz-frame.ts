/** Host viz contract — do not extend with pack-only fields. */
export type {
  VizDataFrame,
  VizHeadline,
  VizPacketSample,
  VizSysTelemetry,
  VizTalkerSample,
} from "../../../../web/src/plugins/viz-host";

import type { VizDataFrame } from "../../../../web/src/plugins/viz-host";

/** Fields this pack reads from each delivered frame. */
export type VoxelVizInput = Pick<
  VizDataFrame,
  "t" | "packets" | "talkers" | "demo" | "sys" | "headlines"
>;
