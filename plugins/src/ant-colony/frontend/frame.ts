/** Host-decimated viz frame slices this pack reads (no extra packet/talker fields). */
import type { VizDataFrame } from "../../../../web/src/plugins/viz-host";

export type AntColonyFrame = Pick<
  VizDataFrame,
  "t" | "dt" | "audio" | "demo" | "packets" | "talkers" | "sys"
>;
