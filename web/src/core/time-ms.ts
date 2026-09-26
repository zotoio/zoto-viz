import type { MonoMs } from "./viz-time";

/** Present timestamp from the mosaic host rAF entry (sub-brand of {@link MonoMs}). */
export type FrameTs = MonoMs & { readonly __frameTsBrand: unique symbol };

/** Sole production mint for {@link FrameTs} (host / pane rAF callback entry). */
export function frameTsFromRaf(ts: DOMHighResTimeStamp): FrameTs {
  return ts as FrameTs;
}
