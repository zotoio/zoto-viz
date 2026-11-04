/**
 * Pane-sized tank: the tank's front face has the pane's aspect ratio, so the camera frames it
 * edge to edge with no letterboxing. Height and depth are fixed real-world sizes, so fish and
 * decor are never scaled (uniform scale 1); a wider pane gets a longer tank. Population scales
 * with the tank's front area and the pane's pixel area, capped for performance.
 */

/** Glass half height / base glass half width (the Blender scape module is 2.4 wide). */
export const TANK_HALF_H = 0.82;
export const TANK_BASE_HALF_W = 1.22;
/** Swim volume inset from the side glass. */
export const SWIM_INSET = 0.02;
export const TANK_MIN_HALF_W = 0.45;
export const TANK_MAX_HALF_W = 3.4;
/** Reference pane (pixels) the fishCount setting is tuned for. */
export const REF_PIXELS = 1280 * 800;
/** Hard cap: fish slots in the viz buffers and the 5120x1440 wall budget. */
export const POP_CAP = 16;
export const POP_MIN = 3;

export interface TankGeometry {
  halfW: number;
  halfH: number;
  /** Width / height of the tank front (= the pane aspect, within the clamps). */
  aspect: number;
  /** Always 1: geometry is never stretched. */
  scale: 1;
  /** Population multiplier vs the reference tank. */
  popScale: number;
}

export function tankForPane(aspect: number | undefined, pixels: number | undefined): TankGeometry {
  const a = aspect !== undefined && Number.isFinite(aspect) && aspect > 0 ? aspect : TANK_BASE_HALF_W / TANK_HALF_H;
  const halfW = Math.max(TANK_MIN_HALF_W, Math.min(TANK_MAX_HALF_W, TANK_HALF_H * a));
  const area = halfW / TANK_BASE_HALF_W;
  const px = pixels !== undefined && Number.isFinite(pixels) && pixels > 0 ? pixels : REF_PIXELS;
  // more pixels show more of the tank in detail: sub-linear, so a 4K pane is not flooded
  const pixK = Math.max(0.6, Math.min(1.35, Math.sqrt(px / REF_PIXELS) ** 0.5));
  return { halfW, halfH: TANK_HALF_H, aspect: halfW / TANK_HALF_H, scale: 1, popScale: area * pixK };
}

/** Fish for this tank from the fishCount setting (tuned at the reference pane). */
export function populationFor(fishCount: number, g: TankGeometry): number {
  return Math.max(Math.min(POP_MIN, fishCount), Math.min(POP_CAP, Math.round(fishCount * g.popScale)));
}

/** Exponential ease of the live half width toward the target (no pops when a pane resizes). */
export function easeHalfW(cur: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-dt * 1.6);
  const next = cur + (target - cur) * k;
  return Math.abs(next - target) < 1e-4 ? target : next;
}
