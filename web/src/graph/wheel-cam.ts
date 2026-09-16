/** Trackpad pinch vs two-finger drag vs a mouse wheel, for the graph camera. */

export type WheelCamMotion = { zoom: number; yaw: number };

function mouseWheelTick(e: { deltaX: number; deltaY: number; deltaMode: number }): boolean {
  if (e.deltaMode !== 0) return true;
  return e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY);
}

/**
 * Pinch (ctrl/meta) and a mouse wheel zoom only.
 * Two-finger trackpad: forward/back dollies, sideways orbits.
 */
export function wheelCamMotion(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): WheelCamMotion {
  if (e.ctrlKey || e.metaKey || mouseWheelTick(e)) return { zoom: e.deltaY, yaw: 0 };
  return { zoom: e.deltaY, yaw: e.deltaX };
}
