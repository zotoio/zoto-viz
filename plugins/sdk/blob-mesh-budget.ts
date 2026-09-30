/**
 * Blob Mesh slot-0 writer, shared by the pack frontend (plugins/src/blob-mesh/frontend/index.ts)
 * and the host mirror (web/src/plugins/viz-pack-host.ts runPackFrameHandler "blob-mesh"), so the
 * two can't drift (#174). Pure math: no DOM, no host transport.
 *
 * Coverage budget (#174) and size contrast (UX Pro ruling on #173):
 * - Every drawn device gets the minimum radius (BLOB_MESH_FLOOR, the same floor the sky applies in
 *   sky/fragment.glsl), so no device vanishes, and sum r^2 over the drawn blobs never exceeds
 *   BLOB_MESH_SLOT_BUDGET. Empty slots draw nothing once any device is written (the sky's idle
 *   blobs only fill a tile with no data yet), so only drawn blobs count.
 * - Contrast: when the busiest drawn device's rate is at least BLOB_MESH_CONTRAST_RATE (2x) the
 *   quietest drawn one's, the busiest radius is at least BLOB_MESH_CONTRAST (1.4x) the quietest's.
 *   Equal rates stay equal size.
 * - Growth reserve: the fit count is decided with the busiest blob already at 1.4x the floor,
 *   (n - 1) floor^2 + (1.4 floor)^2 <= B, so the contrast always fits. At B = 0.1152 and floor
 *   0.12 that's 7 blobs (8 would need 0.1296). The quietest devices past that are dropped
 *   (#173 option b) and the host says so; the minimum is never shrunk and blobs never silently
 *   overlap past the budget.
 * - Radii for the n drawn devices, all in one pass (host and pack share this):
 *   1. target t_i = floor * (1 + G * pos_i): pos_i is the device's place between the quietest (0)
 *      and busiest (1) drawn rate on a log scale, G = 0.4 * min(1, log2(max / min)).
 *   2. the busiest keeps its target; the others' growth above the floor is scaled by one
 *      lambda in [0, 1] so the sum fits the budget (the reserve guarantees lambda >= 0 fits).
 *   3. everything is then scaled up by one s >= 1 while budget allows, capped so the busiest
 *      stays <= floor + BLOB_MESH_GROWTH * min(1, peak / BLOB_MESH_BUSY_PPS) (one busy device
 *      alone still grows to 0.22; a quiet single device stays near the floor).
 */

/** Slots the sky draws (sky/fragment.glsl loops over 8 zotoVizSlots). */
export const BLOB_MESH_MAX_BLOBS = 8;
/** Minimum blob radius; must match `max(<floor>, b.z)` in sky/fragment.glsl. #174 option 1: 0.16 -> 0.12. */
export const BLOB_MESH_FLOOR = 0.12;
/** Most a blob grows above the floor for absolute traffic (busiest at >= BLOB_MESH_BUSY_PPS). */
export const BLOB_MESH_GROWTH = 0.1;
export const BLOB_MESH_BUSY_PPS = 60;
/** Busiest / quietest radius the plan guarantees once the rates differ by BLOB_MESH_CONTRAST_RATE. */
export const BLOB_MESH_CONTRAST = 1.4;
export const BLOB_MESH_CONTRAST_RATE = 2;
/**
 * Slot-space coverage budget (sum of r^2 over drawn blobs): 8 blobs at the floor. #174's floor scan
 * measured 8 blobs at 0.12 as the lowest floor with no dark patches on the live LAN; the rendered
 * 35% can't be reached at any scanned floor without breaking the at-most-2-dark rule, so the budget
 * is pinned in slot space here. One constant to retune from app renders.
 */
export const BLOB_MESH_SLOT_BUDGET = BLOB_MESH_MAX_BLOBS * BLOB_MESH_FLOOR * BLOB_MESH_FLOOR;

export type BlobMeshPlan = {
  /** Indices into the input rates that are drawn, in input order (busiest kept). */
  shownIdx: number[];
  /** Radius per drawn device, same order as shownIdx. */
  radii: number[];
  /** Devices in the frame that aren't drawn (quietest first to go). */
  hidden: number;
  /** Scale on the non-busiest growth toward their targets, in [0, 1]. */
  lambda: number;
  /** Uniform scale applied last, >= 1. */
  scale: number;
};

/**
 * Devices that fit inside the budget with the growth reserve held back: one blob at
 * BLOB_MESH_CONTRAST x floor plus the rest at the floor (at least 1, at most the slot count).
 */
export function blobMeshFitCount(budget = BLOB_MESH_SLOT_BUDGET, floor = BLOB_MESH_FLOOR): number {
  const reserve = (BLOB_MESH_CONTRAST * floor) ** 2 - floor * floor; // growth reserve
  const fit = Math.floor((budget - reserve) / (floor * floor) + 1e-9);
  return Math.max(1, Math.min(BLOB_MESH_MAX_BLOBS, fit));
}

export function planBlobMesh(
  rates: readonly number[],
  budget = BLOB_MESH_SLOT_BUDGET,
  floor = BLOB_MESH_FLOOR,
): BlobMeshPlan {
  const fit = blobMeshFitCount(budget, floor);
  const order = rates.map((_, i) => i).sort((a, b) => (rates[b]! - rates[a]!) || a - b);
  const shownIdx = order.slice(0, Math.min(fit, rates.length)).sort((a, b) => a - b);
  const hidden = rates.length - shownIdx.length;
  const n = shownIdx.length;
  if (n === 0) return { shownIdx, radii: [], hidden, lambda: 1, scale: 1 };
  const drawn = shownIdx.map((i) => Math.max(0, rates[i]!));
  const hi = Math.max(...drawn);
  const lo = Math.min(...drawn);
  const top = drawn.indexOf(hi);
  // 1. contrast targets
  let gain = 0;
  let pos: (r: number) => number = () => 0;
  if (hi > 0 && lo > 0 && hi > lo) {
    gain = (BLOB_MESH_CONTRAST - 1) * Math.min(1, Math.log(hi / lo) / Math.log(BLOB_MESH_CONTRAST_RATE)); // contrast gain
    pos = (r) => Math.log(r / lo) / Math.log(hi / lo);
  } else if (hi > 0 && lo <= 0) {
    gain = BLOB_MESH_CONTRAST - 1; // contrast gain (a silent device vs any traffic)
    pos = (r) => r / hi;
  }
  const target = drawn.map((r) => floor * (1 + gain * pos(r)));
  // 2. the busiest keeps its target; the others' growth shares what's left of the budget
  let a = 0;
  let b = 0;
  for (let j = 0; j < n; j++) {
    if (j === top) continue;
    const d = target[j]! - floor;
    a += d * d;
    b += 2 * floor * d;
  }
  const c = (n - 1) * floor * floor + target[top]! ** 2 - budget;
  let lambda = 1;
  if (a > 0) {
    lambda = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    lambda = Math.min(1, Math.max(0, lambda));
  }
  const radii = target.map((t, j) => (j === top ? t : floor + lambda * (t - floor)));
  // 3. uniform growth while the budget allows, capped by absolute traffic
  const sumR2 = radii.reduce((s, r) => s + r * r, 0);
  const busyCap = (floor + BLOB_MESH_GROWTH * Math.min(1, hi / BLOB_MESH_BUSY_PPS)) / radii[top]!;
  const scale = Math.max(1, Math.min(Math.sqrt(budget / sumR2), busyCap));
  return { shownIdx, radii: radii.map((r) => r * scale), hidden, lambda, scale };
}

export function blobMeshRoleHue(role: string): number {
  if (role === "gateway") return 0.08;
  if (role === "internet") return 0.78;
  if (role === "lan") return 0.45;
  return 0.22;
}

export type BlobMeshTalker = { id: string; rate: number; role: string };

/** Slot 0 (x, y, radius, hue per drawn device) plus the plan it came from. */
export function packBlobMeshSlots(
  talkers: readonly BlobMeshTalker[],
  t: number,
): { slot0: number[]; plan: BlobMeshPlan } {
  const plan = planBlobMesh(talkers.map((d) => d.rate));
  const slot0: number[] = [];
  plan.shownIdx.forEach((ti, j) => {
    const d = talkers[ti]!;
    const h = (d.id.charCodeAt(0) + j * 19) % 97;
    const ang = (h / 97) * 6.283 + t * (0.15 + j * 0.03);
    const r = 0.25 + (h % 20) / 50;
    slot0.push(Math.cos(ang) * r, Math.sin(ang) * r, plan.radii[j]!, blobMeshRoleHue(d.role));
  });
  return { slot0, plan };
}
