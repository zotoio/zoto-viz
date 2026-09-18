/** Two-finger zoom vs ctrl+two-finger pan vs a mouse wheel, for the graph camera. */

export type WheelCamMotion = { zoom: number; panX: number; panY: number };

/** Keep treating follow-up wheels as ctrl-pan after ctrl/meta drops mid-gesture (Linux Chrome). */
export const PINCH_HOLD_MS = 240;

export function mouseWheelTick(e: { deltaX: number; deltaY: number; deltaMode: number }): boolean {
  if (e.deltaMode !== 0) return true;
  return e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY);
}

export function pinchWheel(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaZ?: number;
  getModifierState?: (key: string) => boolean;
}): boolean {
  return (
    e.ctrlKey
    || e.metaKey
    || Math.abs(e.deltaZ ?? 0) > 0
    || !!e.getModifierState?.("Control")
    || !!e.getModifierState?.("Meta")
    || !!e.getModifierState?.("Accel")
  );
}

/** Scale delta for two-finger zoom. Prefer Y; fall back to Z then X so an angled drag still zooms. */
export function pinchZoomDelta(e: { deltaX: number; deltaY: number; deltaZ?: number }): number {
  if (e.deltaY !== 0) return e.deltaY;
  if ((e.deltaZ ?? 0) !== 0) return e.deltaZ as number;
  return e.deltaX;
}

/** Screen pixels of three-finger drag → OrbitControls wheel delta. Drag up zooms in. */
export const THREE_FINGER_ZOOM = 2.4;

export function pointerCentroid(pts: Iterable<{ x: number; y: number }>): { x: number; y: number } | null {
  let n = 0, x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; n++; }
  return n ? { x: x / n, y: y / n } : null;
}

/** Positive dy (fingers move down) zooms out, matching a mouse-wheel roll down. */
export function threeFingerZoomDelta(dy: number): number {
  return dy * THREE_FINGER_ZOOM;
}

/**
 * Two-finger trackpad drag zooms. Ctrl/meta + two-finger (and a short hold after
 * Linux drops the modifier) pans in the same direction as a right-button drag.
 * A mouse wheel still zooms. Three-finger drag also zooms (see threeFingerZoomDelta).
 */
export function wheelCamMotion(
  e: {
    ctrlKey: boolean;
    metaKey: boolean;
    deltaX: number;
    deltaY: number;
    deltaZ?: number;
    deltaMode: number;
  },
  hold = false,
): WheelCamMotion {
  if (mouseWheelTick(e)) return { zoom: e.deltaY, panX: 0, panY: 0 };
  if (pinchWheel(e) || hold) return { zoom: 0, panX: 0 - e.deltaX, panY: 0 - e.deltaY };
  return { zoom: pinchZoomDelta(e), panX: 0, panY: 0 };
}
