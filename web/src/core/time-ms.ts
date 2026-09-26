/** Monotonic milliseconds (durations, viz budget clock, FPS window queries). */
export type MonoMs = number & { readonly __monoMsBrand: unique symbol };

/** Present timestamp from the mosaic host rAF entry (sub-brand of {@link MonoMs}). */
export type FrameTs = MonoMs & { readonly __frameTsBrand: unique symbol };

export function monoMs(ms: number): MonoMs {
  return ms as MonoMs;
}
