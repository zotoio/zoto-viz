/** Branded time scalars (mint only in this module). */
export type FrameTs = number & { readonly __brand: "frameTs" };
export type MonoMs = number & { readonly __brand: "monoMs" };
export type WallMs = number & { readonly __brand: "wallMs" };
export type EpochSec = number & { readonly __brand: "epochSec" };

export function asFrameTs(v: number): FrameTs {
  return v as FrameTs;
}

export function asMonoMs(v: number): MonoMs {
  return v as MonoMs;
}

export function asWallMs(v: number): WallMs {
  return v as WallMs;
}

export function asEpochSec(v: number): EpochSec {
  return v as EpochSec;
}
