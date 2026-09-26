/** Monotonic host-frame timestamps (rAF / injected viz clock). Replaced by #52's brands on merge. */
export type MonoMs = number & { readonly __monoMsBrand: unique symbol };

/** Wall-clock milliseconds (Date / performance). */
export type WallMs = number & { readonly __wallMsBrand: unique symbol };

export function monoMs(ms: number): MonoMs {
  return ms as MonoMs;
}

export function wallMs(ms: number): WallMs {
  return ms as WallMs;
}
