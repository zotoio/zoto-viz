/**
 * WebAssembly kernels for the force layout (AssemblyScript; compiled to src/graph/layout.wasm).
 *
 * `manyBody` is d3-force-3d's Barnes–Hut many-body force over flat arrays: build an octree of the
 * bodies, accumulate charge and centre of charge per cell, then for each body walk the tree and
 * apply cells that are far enough (width² / θ² < distance²) as a single charge. Same cube cover,
 * same constants and same close-range handling (distanceMin, jiggle) as the JavaScript force it
 * replaces, so switching kernels does not change the layout.
 *
 * `magnet` is the same-role pairwise attraction / repulsion from physics.ts (O(n²)).
 *
 * The host (layout-wasm.ts) owns no memory of its own: after `ensure(n)` it asks for pointers to
 * the input / output arrays inside this module's memory and reads / writes them through views.
 */

// ---------------------------------------------------------------- buffers

let cap: i32 = 0;
let pos: Float32Array = new Float32Array(0);   // x,y,z per body
let str: Float32Array = new Float32Array(0);   // charge per body
let out: Float32Array = new Float32Array(0);   // vx,vy,vz delta per body
let role: Int32Array = new Int32Array(0);      // role index per body (magnet)
let mag: Float32Array = new Float32Array(16);  // magnet strength per role index

// octree pool. A node is either a leaf (head of a coincident-body chain) or internal (8 children).
let poolCap: i32 = 0;
let child: Int32Array = new Int32Array(0);     // 8 per node, -1 = empty
let leafBody: Int32Array = new Int32Array(0);  // first body of a leaf, -1 for internal nodes
let nextBody: Int32Array = new Int32Array(0);  // coincident-body chain, per body
let cx: Float64Array = new Float64Array(0);    // centre of charge
let cy: Float64Array = new Float64Array(0);
let cz: Float64Array = new Float64Array(0);
let val: Float64Array = new Float64Array(0);   // accumulated charge
let used: i32 = 0;

/** Make room for `n` bodies (and a tree pool sized for them). Returns the body capacity. */
export function ensure(n: i32): i32 {
  if (n > cap) {
    let c = cap < 64 ? 64 : cap;
    while (c < n) c *= 2;
    pos = new Float32Array(c * 3);
    str = new Float32Array(c);
    out = new Float32Array(c * 3);
    role = new Int32Array(c);
    nextBody = new Int32Array(c);
    cap = c;
  }
  growPool(n * 4 + 64);
  return cap;
}

/** Enlarge the octree pool to at least `want` nodes (deep splits of near-coincident points need more). */
export function growPool(want: i32): i32 {
  if (want > poolCap) {
    let c = poolCap < 512 ? 512 : poolCap;
    while (c < want) c *= 2;
    child = new Int32Array(c * 8);
    leafBody = new Int32Array(c);
    cx = new Float64Array(c);
    cy = new Float64Array(c);
    cz = new Float64Array(c);
    val = new Float64Array(c);
    poolCap = c;
  }
  return poolCap;
}

export function posPtr(): usize { return pos.dataStart; }
export function strPtr(): usize { return str.dataStart; }
export function outPtr(): usize { return out.dataStart; }
export function rolePtr(): usize { return role.dataStart; }
export function magPtr(): usize { return mag.dataStart; }
export function magLen(): i32 { return mag.length; }

// ---------------------------------------------------------------- accessors (no bounds checks in the hot path)

// @ts-ignore: decorator
@inline function px(i: i32): f64 { return <f64>unchecked(pos[i * 3]); }
// @ts-ignore: decorator
@inline function py(i: i32): f64 { return <f64>unchecked(pos[i * 3 + 1]); }
// @ts-ignore: decorator
@inline function pz(i: i32): f64 { return <f64>unchecked(pos[i * 3 + 2]); }
// @ts-ignore: decorator
@inline function childOf(node: i32, k: i32): i32 { return unchecked(child[node * 8 + k]); }
// @ts-ignore: decorator
@inline function setChild(node: i32, k: i32, v: i32): void { unchecked(child[node * 8 + k] = v); }

// ---------------------------------------------------------------- random jiggle

let seed: u32 = 0x9e3779b9;

function jiggle(): f64 {
  // xorshift32, scaled like d3's (random() - 0.5) * 1e-6
  seed ^= seed << 13;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  return ((<f64>seed) / 4294967296.0 - 0.5) * 1e-6;
}

// ---------------------------------------------------------------- octree build

function newNode(leaf: i32): i32 {
  const id = used++;
  if (id >= poolCap) return -1;
  for (let k = 0; k < 8; k++) setChild(id, k, -1);
  unchecked(leafBody[id] = leaf);
  unchecked(val[id] = 0);
  return id;
}

let root: i32 = -1;
let rx0: f64 = 0, ry0: f64 = 0, rz0: f64 = 0, rsize: f64 = 1;

/** Insert body `d` (d3-octree `add`). Returns false when the node pool is exhausted. */
function insert(d: i32): bool {
  const x = px(d), y = py(d), z = pz(d);
  if (root < 0) {
    root = newNode(d);
    unchecked(nextBody[d] = -1);
    return root >= 0;
  }
  let node = root;
  let parent = -1;
  let slot = 0;
  let x0 = rx0, y0 = ry0, z0 = rz0, size = rsize;
  // descend to a leaf or an empty slot
  while (unchecked(leafBody[node]) < 0) {
    const half = size * 0.5;
    const xm = x0 + half, ym = y0 + half, zm = z0 + half;
    const right: i32 = x >= xm ? 1 : 0, bottom: i32 = y >= ym ? 1 : 0, deep: i32 = z >= zm ? 1 : 0;
    if (right) x0 = xm;
    if (bottom) y0 = ym;
    if (deep) z0 = zm;
    size = half;
    slot = (deep << 2) | (bottom << 1) | right;
    parent = node;
    node = childOf(parent, slot);
    if (node < 0) {
      const leaf = newNode(d);
      if (leaf < 0) return false;
      unchecked(nextBody[d] = -1);
      setChild(parent, slot, leaf);
      return true;
    }
  }
  // a leaf: a coincident point joins the head of its chain
  const other = unchecked(leafBody[node]);
  const ox = px(other), oy = py(other), oz = pz(other);
  if (ox == x && oy == y && oz == z) {
    unchecked(nextBody[d] = other);
    unchecked(leafBody[node] = d);
    return true;
  }
  // otherwise split the leaf until the old and new point separate
  let i: i32, j: i32;
  do {
    const inner = newNode(-1);
    if (inner < 0) return false;
    if (parent < 0) root = inner;
    else setChild(parent, slot, inner);
    parent = inner;
    const half = size * 0.5;
    const xm = x0 + half, ym = y0 + half, zm = z0 + half;
    const right: i32 = x >= xm ? 1 : 0, bottom: i32 = y >= ym ? 1 : 0, deep: i32 = z >= zm ? 1 : 0;
    i = (deep << 2) | (bottom << 1) | right;
    j = ((oz >= zm ? 1 : 0) << 2) | ((oy >= ym ? 1 : 0) << 1) | (ox >= xm ? 1 : 0);
    if (right) x0 = xm;
    if (bottom) y0 = ym;
    if (deep) z0 = zm;
    size = half;
    slot = i;
  } while (i == j);
  setChild(parent, j, node);
  const leaf = newNode(d);
  if (leaf < 0) return false;
  unchecked(nextBody[d] = -1);
  setChild(parent, i, leaf);
  return true;
}

// ---------------------------------------------------------------- accumulate (post-order)

function accumulate(node: i32): void {
  const first = unchecked(leafBody[node]);
  if (first >= 0) {
    let s: f64 = 0;
    let b = first;
    while (b >= 0) { s += <f64>unchecked(str[b]); b = unchecked(nextBody[b]); }
    unchecked(cx[node] = px(first));
    unchecked(cy[node] = py(first));
    unchecked(cz[node] = pz(first));
    unchecked(val[node] = s);
    return;
  }
  let strength: f64 = 0, weight: f64 = 0, x: f64 = 0, y: f64 = 0, z: f64 = 0;
  for (let k = 0; k < 8; k++) {
    const q = childOf(node, k);
    if (q < 0) continue;
    accumulate(q);
    const v = unchecked(val[q]);
    const c = Math.abs(v);
    if (c == 0) continue;
    strength += v;
    weight += c;
    x += c * unchecked(cx[q]);
    y += c * unchecked(cy[q]);
    z += c * unchecked(cz[q]);
  }
  strength *= 0.7071067811865476; // Math.sqrt(4 / 8): d3 scales accumulated strength by the child count
  if (weight > 0) {
    unchecked(cx[node] = x / weight);
    unchecked(cy[node] = y / weight);
    unchecked(cz[node] = z / weight);
  }
  unchecked(val[node] = strength);
}

// ---------------------------------------------------------------- apply

let bi: i32 = 0;
let bx: f64 = 0, by: f64 = 0, bz: f64 = 0;
let avx: f64 = 0, avy: f64 = 0, avz: f64 = 0;
let gAlpha: f64 = 0, gTheta2: f64 = 0.81, gMin2: f64 = 1, gMax2: f64 = Infinity;

function apply(node: i32, x0: f64, y0: f64, z0: f64, size: f64): void {
  const v = unchecked(val[node]);
  if (v == 0) return;
  let x = unchecked(cx[node]) - bx, y = unchecked(cy[node]) - by, z = unchecked(cz[node]) - bz;
  let l = x * x + y * y + z * z;
  // Barnes–Hut: the whole cell as one charge when it is small relative to its distance
  if (size * size / gTheta2 < l) {
    if (l < gMax2) {
      if (x == 0) { x = jiggle(); l += x * x; }
      if (y == 0) { y = jiggle(); l += y * y; }
      if (z == 0) { z = jiggle(); l += z * z; }
      if (l < gMin2) l = Math.sqrt(gMin2 * l);
      const w = v * gAlpha / l;
      avx += x * w; avy += y * w; avz += z * w;
    }
    return;
  }
  const first = unchecked(leafBody[node]);
  if (first < 0) {
    // internal and too close: descend
    const half = size * 0.5;
    for (let k = 0; k < 8; k++) {
      const q = childOf(node, k);
      if (q < 0) continue;
      apply(q, (k & 1) ? x0 + half : x0, (k & 2) ? y0 + half : y0, (k & 4) ? z0 + half : z0, half);
    }
    return;
  }
  if (l >= gMax2) return;
  // leaf: every body in it, except this one
  if (first != bi || unchecked(nextBody[first]) >= 0) {
    if (x == 0) { x = jiggle(); l += x * x; }
    if (y == 0) { y = jiggle(); l += y * y; }
    if (z == 0) { z = jiggle(); l += z * z; }
    if (l < gMin2) l = Math.sqrt(gMin2 * l);
  }
  let b = first;
  while (b >= 0) {
    if (b != bi) {
      const w = <f64>unchecked(str[b]) * gAlpha / l;
      avx += x * w; avy += y * w; avz += z * w;
    }
    b = unchecked(nextBody[b]);
  }
}

/**
 * Many-body pass over the first `n` bodies. Overwrites `out` with velocity deltas.
 * Returns 0 on success, -1 when the tree pool ran out (grow it and retry, or skip this tick).
 */
export function manyBody(n: i32, alpha: f32, theta2: f32, distMin2: f32, distMax2: f32): i32 {
  if (n > cap) return -2;
  if (n < 2) { clearOut(n); return 0; }
  // bounding cube like d3-octree's cover(): integer origin, power-of-two size, points strictly inside
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = px(i), y = py(i), z = pz(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  rx0 = Math.floor(minX); ry0 = Math.floor(minY); rz0 = Math.floor(minZ);
  const span = Math.max(maxX - rx0, Math.max(maxY - ry0, maxZ - rz0));
  let size: f64 = 1;
  while (size <= span) size *= 2;
  rsize = size;
  used = 0;
  root = -1;
  for (let i = 0; i < n; i++) if (!insert(i)) return -1;
  accumulate(root);
  gAlpha = <f64>alpha; gTheta2 = <f64>theta2; gMin2 = <f64>distMin2; gMax2 = <f64>distMax2;
  for (let i = 0; i < n; i++) {
    bi = i;
    bx = px(i); by = py(i); bz = pz(i);
    avx = 0; avy = 0; avz = 0;
    apply(root, rx0, ry0, rz0, rsize);
    unchecked(out[i * 3] = <f32>avx);
    unchecked(out[i * 3 + 1] = <f32>avy);
    unchecked(out[i * 3 + 2] = <f32>avz);
  }
  return 0;
}

// ---------------------------------------------------------------- magnets

/**
 * Same-role attraction / repulsion (physics.ts `magnetForce`). `mag` holds the strength per role
 * index, `cross` the strength between different roles, `maxD2` the squared reach, `s` the pulse.
 * Adds into `out`, so call it after `manyBody` (or `clearOut`).
 */
export function magnet(n: i32, alpha: f32, cross: f32, maxD2: f32, s: f32): void {
  if (n > cap) return;
  const sa: f64 = <f64>s * 90.0 * <f64>alpha;
  const md2: f64 = <f64>maxD2;
  const xk: f64 = <f64>cross;
  const nm = mag.length;
  for (let i = 0; i < n; i++) {
    const ra = unchecked(role[i]);
    const ka: f64 = ra >= 0 && ra < nm ? <f64>unchecked(mag[ra]) : 0;
    const ax = px(i), ay = py(i), az = pz(i);
    // accumulate body i in registers; body j is updated in place
    let ix: f64 = 0, iy: f64 = 0, iz: f64 = 0;
    for (let j = i + 1; j < n; j++) {
      const k: f64 = ra == unchecked(role[j]) ? ka : xk;
      if (Math.abs(k) < 0.02) continue;
      const dx = px(j) - ax, dy = py(j) - ay, dz = pz(j) - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > md2 || d2 < 4) continue;
      const d = Math.sqrt(d2);
      // (dx / d) * (k * sa / max(d, 18)) with a single division
      const g = k * sa / (d * Math.max(d, 18.0));
      const fx = dx * g, fy = dy * g, fz = dz * g;
      ix += fx; iy += fy; iz += fz;
      unchecked(out[j * 3] -= <f32>fx); unchecked(out[j * 3 + 1] -= <f32>fy); unchecked(out[j * 3 + 2] -= <f32>fz);
    }
    unchecked(out[i * 3] += <f32>ix); unchecked(out[i * 3 + 1] += <f32>iy); unchecked(out[i * 3 + 2] += <f32>iz);
  }
}

/** Zero the output deltas for `n` bodies. */
export function clearOut(n: i32): void {
  const m = n * 3;
  for (let i = 0; i < m; i++) unchecked(out[i] = 0);
}
