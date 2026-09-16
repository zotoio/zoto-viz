/** Target fraction of each dream cycle that the activity centroid stays near viewport centre. */
export const ACTIVITY_CENTER_HOLD = 0.7;

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 1 = look-at on the activity centroid, 0 = cinematic wander (wide / captured pose).
 * `phase` is 0..1 along the zoom cycle (0 = zoomed out). High for `hold` of the period,
 * with the wander valley at zoom-out so the wide shot can leave centre.
 */
export function activityCenterHold(phase: number, hold = ACTIVITY_CENTER_HOLD): number {
  const u = ((phase % 1) + 1) % 1;
  const h = Math.min(0.95, Math.max(0.5, hold));
  const half = (1 - h) / 2;
  const edge = Math.min(0.06, half * 0.8);
  const d = Math.min(u, 1 - u);
  if (d >= half) return 1;
  if (d <= half - edge) return 0;
  return smooth01((d - (half - edge)) / edge);
}

/** Look-at mix toward activity. Off when the user framed the view or focus is the whole graph. */
export function activityLookMix(opts: {
  focus: string;
  pinned: boolean;
  focusW: number;
  phase: number;
}): number {
  if (opts.pinned || opts.focus === "cloud") return 0;
  const w = Math.min(1, Math.max(0, opts.focusW));
  return activityCenterHold(opts.phase) * w;
}

/**
 * Extra mix toward the projected activity point so it stays inside the central `limit`
 * of NDC (|x|,|y| ≤ limit). 0.7 is the central 70% of the viewport.
 */
export function centerMixForNdc(nx: number, ny: number, limit = ACTIVITY_CENTER_HOLD): number {
  const m = Math.max(Math.abs(nx), Math.abs(ny));
  if (m <= limit || m < 1e-6) return 0;
  return Math.min(1, 1 - limit / m);
}
