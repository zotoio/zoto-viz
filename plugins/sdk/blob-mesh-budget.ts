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
 * - Growth reserve, only when the drawn rates differ: the fit count is the most busiest-first
 *   devices whose minimum shape fits, (n - 1) floor^2 + (floor (1 + G_n))^2 <= B, with G_n the
 *   contrast gain of those n (below; 0 when their rates are all equal). Equal devices fit 8 at the
 *   floor; with differing rates the busiest's growth is held back first, so 7 fit at 0.12 when
 *   they are 2x apart (8 would need 0.1296). The quietest devices past that are dropped (#173
 *   option b) and the host says so ("more" instead of "quieter" when a dropped device ties the
 *   quietest shown); the minimum is never shrunk and blobs never silently overlap past the budget.
 * - Radii for the n drawn devices, all in one pass (host and pack share this):
 *   1. target t_i = floor * (1 + G * pos_i): pos_i is the device's place between the quietest (0)
 *      and busiest (1) drawn rate on a log scale, G = 0.4 * min(1, log2(max / min)).
 *   2. the busiest (every device tied for busiest) keeps its target; the others' growth above the
 *      floor is scaled by one lambda in [0, 1] so the sum fits (the reserve guarantees lambda >= 0
 *      fits). Radius order matches rate order, and equal rates get equal radii.
 *   3. everything is then scaled up by one s >= 1 until the drawn devices use the whole budget
 *      (sum r^2 = B). No absolute-traffic cap: one device alone is one big blob (sqrt(B) = 0.339),
 *      and a quiet LAN's devices share the budget evenly.
 */

/** Slots the sky draws (sky/fragment.glsl loops over 8 zotoVizSlots). */
export const BLOB_MESH_MAX_BLOBS = 8;
/** Minimum blob radius; must match `max(<floor>, b.z)` in sky/fragment.glsl. #174 option 1: 0.16 -> 0.12. */
export const BLOB_MESH_FLOOR = 0.12;
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
  /** A hidden device is exactly as busy as the quietest shown one (a tie at the cut). */
  tieAtCut: boolean;
  /** Scale on the non-busiest growth toward their targets, in [0, 1]. */
  lambda: number;
  /** Uniform scale applied last, >= 1. */
  scale: number;
};

/** Contrast gain G for these drawn rates: 0.4 * min(1, log2(max / min)); 0 when all equal. */
export function blobMeshContrastGain(drawn: readonly number[]): number {
  const hi = Math.max(...drawn);
  const lo = Math.min(...drawn);
  if (hi > 0 && lo > 0 && hi > lo) return (BLOB_MESH_CONTRAST - 1) * Math.min(1, Math.log(hi / lo) / Math.log(BLOB_MESH_CONTRAST_RATE));
  if (hi > 0 && lo <= 0) return BLOB_MESH_CONTRAST - 1;
  return 0;
}

export function planBlobMesh(
  rates: readonly number[],
  budget = BLOB_MESH_SLOT_BUDGET,
  floor = BLOB_MESH_FLOOR,
): BlobMeshPlan {
  const order = rates.map((_, i) => i).sort((a, b) => (rates[b]! - rates[a]!) || a - b);
  const clean = (i: number) => Math.max(0, rates[i]!);
  let fit = Math.min(BLOB_MESH_MAX_BLOBS, rates.length);
  for (; fit > 1; fit--) {
    const top = order.slice(0, fit).map(clean);
    const g = blobMeshContrastGain(top); // reserve only when rates differ
    const k = top.filter((r) => r === top[0]).length; // devices tied for busiest keep the same size
    if ((fit - k) * floor * floor + k * (floor * (1 + g)) ** 2 <= budget + 1e-12) break;
  }
  const shownIdx = order.slice(0, fit).sort((a, b) => a - b);
  const hidden = rates.length - shownIdx.length;
  const tieAtCut = hidden > 0 && clean(order[fit]!) === clean(order[fit - 1]!);
  const n = shownIdx.length;
  if (n === 0) return { shownIdx, radii: [], hidden, tieAtCut, lambda: 1, scale: 1 };
  const drawn = shownIdx.map((i) => Math.max(0, rates[i]!));
  const hi = Math.max(...drawn);
  const lo = Math.min(...drawn);
  const isTop = drawn.map((r) => r === hi);
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
  let k = 0;
  for (let j = 0; j < n; j++) {
    if (isTop[j]) {
      k++;
      continue;
    }
    const d = target[j]! - floor;
    a += d * d;
    b += 2 * floor * d;
  }
  const c = (n - k) * floor * floor + k * target[drawn.indexOf(hi)]! ** 2 - budget;
  let lambda = 1;
  if (a > 0) {
    lambda = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    lambda = Math.min(1, Math.max(0, lambda));
  }
  const radii = target.map((t, j) => (isTop[j] ? t : floor + lambda * (t - floor)));
  // 3. grow into the whole budget (no absolute-traffic cap)
  const sumR2 = radii.reduce((s, r) => s + r * r, 0);
  const scale = Math.max(1, Math.sqrt(budget / sumR2)); // grow into budget
  return { shownIdx, radii: radii.map((r) => r * scale), hidden, tieAtCut, lambda, scale };
}

export function blobMeshRoleHue(role: string): number {
  if (role === "gateway") return 0.08;
  if (role === "internet") return 0.78;
  if (role === "lan") return 0.45;
  return 0.22;
}

export type BlobMeshTalker = { id: string; rate: number; role: string };

/** FNV-1a 32-bit over the whole id (stable across host and pack; replaces the first-character seed). */
export function blobMeshIdHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/*
 * Visible region. The sky maps a camera ray to the blob plane as
 *   dir = (c.x, T (c.y + c.z), T (c.z - c.y)),  uv = dir.xz / (L + |dir.y|),  T = cos 45, L = 0.35
 * (sky/fragment.glsl), and draws a slot at uv = xy * 1.7. The host camera looks down -z with the
 * default lens: base vertical FOV 55 deg with the horizontal capped at 64 deg (graph/lens-fov.ts),
 * so on the app's 1280 x 800 view the ray spans tan(32 deg) x tan(32 deg) / 1.6. Pushing the view's
 * centre and edge rays through that map gives the part of the plane the camera sees: centred at
 * uv (0, -0.669), from uv.y -1.22 (top edge) to -0.32 (bottom edge), half-width 0.44 at the bottom
 * edge; the inscribed circle around the centre has radius 0.352 (bottom edge). The upper half of the
 * plane (uv.y > 0) is never on screen, which is where first-character angles parked lone blobs.
 */
export const BLOB_MESH_SKY_TILT = 0.70710678;
export const BLOB_MESH_SKY_LIFT = 0.35;
export const BLOB_MESH_SLOT_TO_UV = 1.7;
/** Host camera ray span at the app's default lens and 1280 x 800 (tan of the half-FOVs). */
export const BLOB_MESH_HOST_SPAN: readonly [number, number] = [Math.tan((32 * Math.PI) / 180), Math.tan((32 * Math.PI) / 180) / 1.6];

/** The sky's uv for a camera-space ray (x, y, -1) (same map as the shader). */
export function blobMeshSkyUv(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y, 1);
  const cx = x / len;
  const cy = y / len;
  const cz = -1 / len;
  const dy = BLOB_MESH_SKY_TILT * (cy + cz);
  const dz = BLOB_MESH_SKY_TILT * (cz - cy);
  const k = 1 / (BLOB_MESH_SKY_LIFT + Math.abs(dy));
  return [cx * k, dz * k];
}

/** Centre and inscribed radius (uv) of what the camera sees of the blob plane. */
export function blobMeshVisibleRegion(span: readonly [number, number] = BLOB_MESH_HOST_SPAN): { cx: number; cy: number; half: number } {
  const [sx, sy] = span;
  const [cx, cy] = blobMeshSkyUv(0, 0);
  const top = blobMeshSkyUv(0, sy)[1];
  const bottom = blobMeshSkyUv(0, -sy)[1];
  const halfH = Math.min(Math.abs(top - cy), Math.abs(bottom - cy));
  const halfW = Math.min(blobMeshSkyUv(sx, -sy)[0], blobMeshSkyUv(sx, 0)[0], blobMeshSkyUv(sx, sy)[0]);
  return { cx, cy, half: Math.min(halfW, halfH) };
}

/** Each device orbits the visible centre at a hashed radius between these shares of the inscribed radius. */
export const BLOB_MESH_ORBIT_MIN = 0.15;
export const BLOB_MESH_ORBIT_MAX = 0.5;
const VISIBLE = blobMeshVisibleRegion();

/**
 * Where a device's blob sits at time t, from its id alone (never its slot, rank or the other
 * devices): it circles the visible centre at a hashed radius, phase and speed, so every drawn blob
 * stays on screen and a device keeps its place as others come and go. Returns slot xy (uv / 1.7).
 */
export function blobMeshPlacement(id: string, t: number): [number, number] {
  const h = blobMeshIdHash(id); // whole-id hash
  const phase = ((h & 0xffff) / 65536) * 6.283;
  const orbit = VISIBLE.half * (BLOB_MESH_ORBIT_MIN + (BLOB_MESH_ORBIT_MAX - BLOB_MESH_ORBIT_MIN) * (((h >>> 16) & 0xff) / 255));
  const speed = (0.12 + 0.08 * ((h >>> 24) / 255)) * ((h & 0x10000) ? 1 : -1);
  const ang = phase + t * speed;
  return [(VISIBLE.cx + Math.cos(ang) * orbit) / BLOB_MESH_SLOT_TO_UV, (VISIBLE.cy + Math.sin(ang) * orbit) / BLOB_MESH_SLOT_TO_UV]; // in-view placement
}

/** Slot 0 (x, y, radius, hue per drawn device) plus the plan it came from. */
export function packBlobMeshSlots(
  talkers: readonly BlobMeshTalker[],
  t: number,
): { slot0: number[]; plan: BlobMeshPlan } {
  const plan = planBlobMesh(talkers.map((d) => d.rate));
  const slot0: number[] = [];
  plan.shownIdx.forEach((ti, j) => {
    const d = talkers[ti]!;
    const [x, y] = blobMeshPlacement(d.id, t);
    slot0.push(x, y, plan.radii[j]!, blobMeshRoleHue(d.role));
  });
  return { slot0, plan };
}
