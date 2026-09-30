/**
 * Blob Mesh slot-0 writer, shared by the pack frontend (plugins/src/blob-mesh/frontend/index.ts)
 * and the host mirror (web/src/plugins/viz-pack-host.ts runPackFrameHandler "blob-mesh"), so the
 * two can't drift (#174). Pure math: no DOM, no host transport.
 *
 * Coverage budget (#174):
 * - Every drawn device gets the minimum radius first (BLOB_MESH_FLOOR, the same floor the sky
 *   applies in sky/fragment.glsl), so no device vanishes.
 * - Only the part above the minimum is scaled by one factor k in [0, 1], so the sum of r^2 over
 *   the drawn blobs stays at or under the slot budget:
 *     e_i = 0.1 * share_i * min(1, peak / 60),  r_i = floor + k * e_i,
 *     sum(e^2) k^2 + 2 floor sum(e) k + n floor^2 - B = 0.
 *   Empty slots draw nothing once any device is written (the sky's idle blobs only fill a tile
 *   with no data yet), so the idle term is n floor^2, not 8 floor^2.
 * - If the minimums alone would exceed the budget, the quietest devices are dropped until they
 *   fit (#173 option b) and the host says so; the minimum is never shrunk and blobs never
 *   silently overlap past the budget.
 */

/** Slots the sky draws (sky/fragment.glsl loops over 8 zotoVizSlots). */
export const BLOB_MESH_MAX_BLOBS = 8;
/** Minimum blob radius; must match `max(<floor>, b.z)` in sky/fragment.glsl. #174 option 1: 0.16 -> 0.12. */
export const BLOB_MESH_FLOOR = 0.12;
/** Growth above the floor for the busiest device at >= BLOB_MESH_BUSY_PPS. */
export const BLOB_MESH_GROWTH = 0.1;
export const BLOB_MESH_BUSY_PPS = 60;
/**
 * Slot-space coverage budget (sum of r^2 over drawn blobs): a full mesh of 8 blobs at the floor.
 * #174's floor scan measured 8 blobs at 0.12 as the lowest floor with no dark patches on the live
 * LAN; the rendered 35% can't be reached at any scanned floor without breaking the at-most-2-dark
 * rule, so the budget is pinned in slot space here. One constant to retune from app renders.
 */
export const BLOB_MESH_SLOT_BUDGET = BLOB_MESH_MAX_BLOBS * BLOB_MESH_FLOOR * BLOB_MESH_FLOOR;

export type BlobMeshPlan = {
  /** Indices into the input rates that are drawn, in input order (busiest kept). */
  shownIdx: number[];
  /** Radius per drawn device, same order as shownIdx. */
  radii: number[];
  /** Devices in the frame that aren't drawn (quietest first to go). */
  hidden: number;
  /** Scale on the part above the floor, in [0, 1]. */
  k: number;
};

/** Devices that fit at the floor inside the budget (at least 1, at most the slot count). */
export function blobMeshFitCount(budget = BLOB_MESH_SLOT_BUDGET, floor = BLOB_MESH_FLOOR): number {
  const fit = Math.floor(budget / (floor * floor) + 1e-9);
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
  const peak = rates.reduce((m, r) => Math.max(m, r), 0);
  const busy = Math.min(1, peak / BLOB_MESH_BUSY_PPS);
  const e = shownIdx.map((i) => (peak > 0 ? BLOB_MESH_GROWTH * (rates[i]! / peak) * busy : 0));
  let sumE = 0;
  let sumE2 = 0;
  for (const v of e) {
    sumE += v;
    sumE2 += v * v;
  }
  const c = shownIdx.length * floor * floor - budget;
  let k: number;
  if (c >= 0) k = 0; // the minimums alone fill the budget: the minimum wins
  else if (sumE2 <= 0) k = 1;
  else {
    const b = 2 * floor * sumE;
    k = (-b + Math.sqrt(b * b - 4 * sumE2 * c)) / (2 * sumE2);
    k = Math.min(1, Math.max(0, k));
  }
  return { shownIdx, radii: e.map((v) => floor + k * v), hidden, k };
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
