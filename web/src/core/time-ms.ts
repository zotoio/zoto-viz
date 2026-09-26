/** Monotonic milliseconds (durations, viz budget clock, FPS window queries). */
export type MonoMs = number & { readonly __monoMsBrand: unique symbol };

/** Present timestamp from the mosaic host rAF entry (sub-brand of {@link MonoMs}). */
export type FrameTs = MonoMs & { readonly __frameTsBrand: unique symbol };

export function monoMs(ms: number): MonoMs {
  return ms as MonoMs;
}

/** Sole production mint for {@link FrameTs} (host / pane rAF callback entry). */
export function frameTsFromRaf(ts: DOMHighResTimeStamp): FrameTs {
  return ts as FrameTs;
}
