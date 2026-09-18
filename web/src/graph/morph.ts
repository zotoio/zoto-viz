/** Seconds for node-shape / mesh pose morph after a view or dice roll. */
export const VIEW_MORPH_S = 1.05;

export function smoothstep(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Lerp a SHAPES index (and in-between morphs) with a smoothstep ease. */
export function mixShape(from: number, want: number, t: number): number {
  return from + (want - from) * smoothstep(t);
}

/** Incoming fade (0 → 1) for sky / mesh opacity on a view transition. */
export function mixFade(t: number): number {
  return smoothstep(t);
}
