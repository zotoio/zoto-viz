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
 * - Count first, then shape. Growth reserve, only when the drawn rates differ: the fit count is
 *   the most busiest-first devices whose minimum shape fits, (n - k) floor^2 + k (floor (1 + G_n))^2
 *   <= B, with k devices tied for busiest and G_n the contrast gain of those n (below; 0 when their
 *   rates are all equal). Equal devices fit 8 at the floor; with differing rates the busiest's
 *   growth is held back first. The quietest devices past that are dropped (#173 option b) and the
 *   host says so ("more" instead of "quieter" when a dropped device ties the quietest shown); the
 *   minimum is never shrunk and blobs never silently overlap past the budget.
 * - Half-rate share, only when the leftover budget has room (it never lowers the count): a drawn
 *   device at >= half the busiest drawn rate sits at least BLOB_MESH_HALF_RATE_SHARE (25%) of the
 *   way from the floor to the busiest radius. When those shares don't fit, sizes fall back to plain
 *   rate order (monotonic, ties equal, 1.4x kept). The live LAN gets the share (0.168, 0.132,
 *   5 x 0.12 = 0.117648 <= B).
 * - Radii for the n drawn devices, all in one pass (host and pack share this):
 *   1. target t_i = q * (1 + G * pos_i): pos_i is the device's place between the quietest (0)
 *      and busiest (1) drawn rate on a log scale, G = 0.4 * min(1, log2(max / min)), and q the
 *      quietest's radius (the floor; with the share on and every drawn device >= half the busiest,
 *      its 25% share, so 1.4x still holds between two devices exactly 2x apart).
 *   2. the busiest (every device tied for busiest) keeps its target; every other device starts
 *      from its base (its half-rate share when the share is on, else the floor) and its growth toward its
 *      target is scaled by one lambda in [0, 1] so the sum fits (the reserve guarantees lambda >= 0
 *      fits). Radius order matches rate order, and equal rates get equal radii.
 *   3. everything is then scaled up by one s >= 1 until the drawn devices use the whole budget
 *      (sum r^2 = B). No absolute-traffic cap: one device alone is one big blob (sqrt(B) = 0.343),
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
 * A drawn device at >= half the busiest drawn rate sits at least this share of the way from the
 * floor to the busiest radius (UX Pro "25% half-rate" row), so a busy second device reads as busy.
 */
export const BLOB_MESH_HALF_RATE_SHARE = 0.25;
/**
 * Slot-space coverage budget (sum of r^2 over drawn blobs). It is the smallest clean value that
 * draws all 7 devices of the live LAN (125, 100, 50, 45, 40, 35, 25 pkt/s; LAN11's busiest 7 have
 * the same shape) with every rule held at once:
 *   busiest at 1.4 x floor = 0.168 (its rate is >= 2x the quietest's),
 *   the 100 pkt/s device (>= half the busiest) at floor + 25% of (0.168 - 0.12) = 0.132,
 *   the other five at the floor 0.12:
 *   0.168^2 + 0.132^2 + 5 x 0.12^2 = 0.117648, rounded up to 0.11765 (float margin 2e-6).
 * 8 blobs at the floor (0.1152, #174's floor scan) was the previous budget; 0.1176 would be just
 * under 0.117648 and draw only 6. Equal rates still fit 8 at the floor (0.1152 <= B).
 */
export const BLOB_MESH_SLOT_BUDGET = 0.11765;

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
  /** The 25% half-rate share fit in the leftover budget (false: plain rate-order fallback). */
  halfRateShare: boolean;
};

/** Contrast gain G for these drawn rates: 0.4 * min(1, log2(max / min)); 0 when all equal. */
export function blobMeshContrastGain(drawn: readonly number[]): number {
  const hi = Math.max(...drawn);
  const lo = Math.min(...drawn);
  if (hi > 0 && lo > 0 && hi > lo) return (BLOB_MESH_CONTRAST - 1) * Math.min(1, Math.log(hi / lo) / Math.log(BLOB_MESH_CONTRAST_RATE));
  if (hi > 0 && lo <= 0) return BLOB_MESH_CONTRAST - 1;
  return 0;
}

/**
 * Minimum shape for these drawn rates: the quietest's radius (the floor, or its 25% share when it is
 * itself at >= half the busiest), the busiest's (1 + G) x that, and the half-rate share.
 */
export function blobMeshMinimumShape(drawn: readonly number[], floor = BLOB_MESH_FLOOR): { quietest: number; busiest: number; half: number } {
  const g = blobMeshContrastGain(drawn);
  const hi = Math.max(...drawn);
  const lo = Math.min(...drawn);
  const s = BLOB_MESH_HALF_RATE_SHARE;
  // quietest at >= half the busiest: q = floor + s (busiest - floor) with busiest = (1 + g) q
  const quietest = hi > lo && 2 * lo >= hi ? ((1 - s) * floor) / (1 - s * (1 + g)) : floor;
  const busiest = quietest * (1 + g);
  return { quietest, busiest, half: floor + s * (busiest - floor) };
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
    // count first: floor for every device, the 1.4x reserve only when rates differ (never the half-rate share)
    const g = blobMeshContrastGain(top);
    const k = top.filter((r) => r === top[0]).length; // devices tied for busiest keep the same size
    if ((fit - k) * floor * floor + k * (floor * (1 + g)) ** 2 <= budget + 1e-12) break;
  }
  const shownIdx = order.slice(0, fit).sort((a, b) => a - b);
  const hidden = rates.length - shownIdx.length;
  const tieAtCut = hidden > 0 && clean(order[fit]!) === clean(order[fit - 1]!);
  const n = shownIdx.length;
  if (n === 0) return { shownIdx, radii: [], hidden, tieAtCut, lambda: 1, scale: 1, halfRateShare: false };
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
  // half-rate share only if the leftover budget has room; otherwise plain rate order from the floor
  const isHalf = drawn.map((r, j) => !isTop[j] && hi > lo && 2 * r >= hi);
  const share = blobMeshMinimumShape(drawn, floor);
  const shareNeed = drawn.reduce((s, _, j) => s + (isTop[j] ? share.busiest : isHalf[j] ? share.half : floor) ** 2, 0);
  const halfRateShare = shareNeed <= budget + 1e-12; // share only with room
  const quietest = halfRateShare ? share.quietest : floor;
  const target = drawn.map((r) => quietest * (1 + gain * pos(r)));
  const busiest = quietest * (1 + gain);
  const base = drawn.map((_, j) => (isTop[j] ? busiest : isHalf[j] && halfRateShare ? share.half : floor));
  // 2. the busiest keeps its target; the others' growth above their base shares what's left of the budget
  let a = 0;
  let b = 0;
  let c = -budget;
  for (let j = 0; j < n; j++) {
    const top = Math.max(target[j]!, base[j]!);
    const d = isTop[j] ? 0 : top - base[j]!;
    a += d * d;
    b += 2 * base[j]! * d;
    c += base[j]! ** 2;
  }
  let lambda = 1;
  if (a > 0) {
    lambda = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    lambda = Math.min(1, Math.max(0, lambda));
  }
  const radii = target.map((t, j) => (isTop[j] ? t : base[j]! + lambda * (Math.max(t, base[j]!) - base[j]!)));
  // 3. grow into the whole budget (no absolute-traffic cap)
  const sumR2 = radii.reduce((s, r) => s + r * r, 0);
  const scale = Math.max(1, Math.sqrt(budget / sumR2)); // grow into budget
  return { shownIdx, radii: radii.map((r) => r * scale), hidden, tieAtCut, lambda, scale, halfRateShare };
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

/**
 * Avalanche finaliser (murmur3 fmix32) on top of the FNV-1a id hash: FNV-1a alone barely moves the
 * low and high halves when only the last character differs (172.30.0.21 vs .22 landed 0.002 uv
 * apart), so every placement bit goes through this first.
 */
export function blobMeshMix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
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

/*
 * Spread (UX Pro option 3): drawn blobs use the whole SAFE visible field, not a 0.18 uv knot at the
 * view centre. Safe means a disc of BLOB_MESH_SPREAD_MARGIN (uv) around the centre stays on screen
 * at the default camera: 1.4 x the floor, the largest blob in a 7-device frame, so the body of a
 * crowded frame's blobs isn't clipped (a sparse frame's bigger blobs, up to sqrt(B) = 0.343 alone,
 * can lose some rim at the field's edge; their centres stay in view). The largest axis-aligned
 * ellipse whose every point keeps that disc on screen (scanned through the shader's plane map and
 * the host lens) is centre (0, -0.77), semi-axes 0.41 x 0.28; BLOB_MESH_SPREAD keeps 0.01 inside it.
 */
export const BLOB_MESH_SPREAD_MARGIN = BLOB_MESH_CONTRAST * BLOB_MESH_FLOOR;
export const BLOB_MESH_SPREAD = { cx: 0, cy: -0.77, ax: 0.4, ay: 0.27 } as const;
/**
 * Motion: the whole constellation drifts together on a BLOB_MESH_DRIFT (uv) circle, which keeps
 * every pairwise distance, and each blob adds its own small hashed BLOB_MESH_WOBBLE circle, which
 * can close a pair by at most 2 x 0.015. (Independent per-device orbits let pairs cross: 0.005 uv
 * on the live LAN.)
 */
export const BLOB_MESH_DRIFT = 0.03;
export const BLOB_MESH_WOBBLE = 0.015;
/** Shared drift speed (rad/s). */
export const BLOB_MESH_DRIFT_SPEED = 0.15;

/**
 * Where a device's blob sits at time t, from its id alone (never its slot, rank or the other
 * devices): a hashed home spread uniformly over the safe ellipse (area-uniform radius), plus a small
 * hashed drift circle, so every drawn blob stays in view with its margin and a device keeps its
 * place as others come and go. Returns slot xy (uv / 1.7).
 */
export function blobMeshPlacement(id: string, t: number): [number, number] {
  const h = blobMeshMix(blobMeshIdHash(id)); // whole-id hash
  const h2 = blobMeshMix(h ^ 0x9e3779b9);
  const { cx, cy, ax, ay } = BLOB_MESH_SPREAD;
  const w = BLOB_MESH_DRIFT + BLOB_MESH_WOBBLE; // homes sit this far inside the ellipse
  const homeAng = ((h & 0xffff) / 65536) * 2 * Math.PI;
  const homeRad = Math.sqrt((h >>> 16) / 65535); // area-uniform over the ellipse
  const hx = cx + (ax - w) * homeRad * Math.cos(homeAng);
  const hy = cy + (ay - w) * homeRad * Math.sin(homeAng);
  const drift = t * BLOB_MESH_DRIFT_SPEED; // shared by every blob
  const speed = (0.12 + 0.08 * (((h2 >>> 16) & 0xff) / 255)) * ((h2 & 0x1) ? 1 : -1);
  const ang = ((h2 & 0xffff) / 65536) * 2 * Math.PI + t * speed;
  const x = hx + BLOB_MESH_DRIFT * Math.cos(drift) + BLOB_MESH_WOBBLE * Math.cos(ang);
  const y = hy + BLOB_MESH_DRIFT * Math.sin(drift) + BLOB_MESH_WOBBLE * Math.sin(ang);
  return [x / BLOB_MESH_SLOT_TO_UV, y / BLOB_MESH_SLOT_TO_UV]; // spread placement
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
