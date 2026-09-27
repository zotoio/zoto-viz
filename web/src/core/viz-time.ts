/** Branded clocks — conversion is always named; no bare `* 1000` at call sites. */

export type MonoMs = number & { readonly __brand: "MonoMs" };
export type WallMs = number & { readonly __brand: "WallMs" };
export type EpochSec = number & { readonly __brand: "EpochSec" };

export function monoMs(ms: number): MonoMs {
  return ms as MonoMs;
}

export function wallMs(ms: number): WallMs {
  return ms as WallMs;
}

export function epochSec(sec: number): EpochSec {
  return sec as EpochSec;
}

export function wallMsToMonoMs(_wall: WallMs): MonoMs {
  throw new Error("wallMsToMonoMs: wall and mono clocks are not convertible");
}

export function monoMsToWallMs(_mono: MonoMs): WallMs {
  throw new Error("monoMsToWallMs: mono and wall clocks are not convertible");
}

export function epochSecToWallMs(sec: EpochSec): WallMs {
  return wallMs(sec * 1000);
}

export function wallMsToEpochSec(ms: WallMs): EpochSec {
  return epochSec(ms / 1000);
}

export function monoMsDeltaSec(prev: MonoMs, next: MonoMs): number {
  const d = next - prev;
  return d > 0 ? d / 1000 : 0;
}
