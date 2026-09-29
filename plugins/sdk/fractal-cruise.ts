/** Boundary cruise and deep-zoom charts for fractal-zoom. Pure math, shared by the pack drive and the host software painter (`web/src/graph/software-fractal.ts`). */

export const SEAHORSE_X = -0.743643887037151;
export const SEAHORSE_Y = 0.13182590420533;

export const ORBIT_BUFFERS = 5;
export const ORBIT_STRIDE = 32;
export const ORBIT_MAX = ORBIT_BUFFERS * ORBIT_STRIDE;

export interface Cruise2 {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** Seconds committed to the current filament so a fork does not flicker. */
  hold?: number;
}

export interface JuliaConst {
  x: number;
  y: number;
}

export interface EscapeSample {
  n: number;
  trap: number;
  escaped: boolean;
}

export function windowScale(zoomLog: number, aspect: number): number {
  const dive = Math.max(0, zoomLog + 0.35);
  const aspectK = Math.max(0.25, Math.min(aspect, 2.4) / 1.6);
  return 2.2 * Math.exp(-dive * 1.25) * aspectK;
}

export function zoomLogForWindow(scale: number, aspect: number): number {
  const aspectK = Math.max(0.25, Math.min(aspect, 2.4) / 1.6);
  const unit = Math.max(1e-30, scale) / (2.2 * aspectK);
  const dive = -Math.log(unit) / 1.25;
  return dive - 0.35;
}

export function itersForScale(scale: number): number {
  const depth = Math.log2(Math.max(1, 2.2 / Math.max(scale, 1e-30)));
  return Math.ceil(24 + depth * 7);
}

export function escape2(
  cx: number,
  cy: number,
  maxIter: number,
  julia?: JuliaConst,
): EscapeSample {
  let zx = julia ? cx : 0;
  let zy = julia ? cy : 0;
  const cr = julia ? julia.x : cx;
  const ci = julia ? julia.y : cy;
  let trap = 1e9;
  const cap = Math.max(4, Math.min(160, maxIter | 0));
  for (let i = 0; i < cap; i++) {
    const mag = zx * zx + zy * zy;
    if (mag < trap) trap = mag;
    if (mag > 64) {
      const smooth = i + 1 - Math.log2(Math.log2(Math.max(mag, 1.0001)));
      return { n: smooth, trap, escaped: true };
    }
    const nx = zx * zx - zy * zy + cr;
    zy = 2 * zx * zy + ci;
    zx = nx;
  }
  return { n: cap, trap, escaped: false };
}

const PROBE = 12;

/** Stable 0/1 from a point, so a fork always takes the same passage. */
function forkBit(x: number, y: number, z: number): number {
  let h = 2166136261;
  const mix = (v: number) => {
    h = Math.imul(h ^ (Math.floor(v * 997) | 0), 16777619);
  };
  mix(x);
  mix(y);
  mix(z);
  return (h >>> 0) & 1;
}

function dampAngle(cur: number, want: number, dt: number, omega: number): number {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-Math.max(0.05, omega) * dt));
}

function dampVel(vel: number, target: number, dt: number, omega: number): number {
  const w = Math.max(0.05, omega);
  const y0 = vel - target;
  const e = Math.exp(-w * dt);
  const b = w * y0;
  return target + (y0 + b * dt) * e;
}

/** Slide along the set boundary. Steps are capped to a fraction of the window so the canyon stays in frame. */
export function steerEdge(c: Cruise2, scale: number, dt: number, maxIter: number, julia?: JuliaConst): Cruise2 {
  if (!(dt > 0) || !(scale > 0)) return c;
  const rad = scale * 0.46;
  const samples: number[] = [];
  let lo = 1e9;
  let hi = -1;
  for (let i = 0; i < PROBE; i++) {
    const ang = (i / PROBE) * Math.PI * 2;
    const e = escape2(c.x + Math.cos(ang) * rad, c.y + Math.sin(ang) * rad, maxIter, julia);
    samples.push(e.n);
    if (e.n < lo) lo = e.n;
    if (e.n > hi) hi = e.n;
  }
  let gx = 0;
  let gy = 0;
  let bestScore = -1;
  let bestX = 0;
  let bestY = 0;
  for (let i = 0; i < PROBE; i++) {
    const ang = (i / PROBE) * Math.PI * 2;
    const n = samples[i]!;
    const opp = samples[(i + PROBE / 2) % PROBE]!;
    const contrast = Math.abs(n - opp);
    const edge = n < maxIter - 0.5 ? Math.sin((Math.PI * n) / maxIter) : 0.04;
    const score = contrast + edge * 6;
    const ox = Math.cos(ang);
    const oy = Math.sin(ang);
    gx += ox * (n - (lo + hi) * 0.5);
    gy += oy * (n - (lo + hi) * 0.5);
    if (score > bestScore) {
      bestScore = score;
      bestX = ox;
      bestY = oy;
    }
  }
  const gLen = Math.hypot(gx, gy);
  const center = escape2(c.x, c.y, maxIter, julia);
  let rx = bestX;
  let ry = bestY;
  if (gLen > 1e-6) {
    const outward = center.n > maxIter * 0.82 ? -1 : 1;
    rx = (gx / gLen) * outward;
    ry = (gy / gLen) * outward;
  }
  let tx = -ry;
  let ty = rx;
  if (tx * Math.cos(c.heading) + ty * Math.sin(c.heading) < 0) {
    tx = -tx;
    ty = -ty;
  }
  const along = hi - lo < 1.5 ? 0.12 : 0.28;
  const pull = hi - lo < 1.5 ? 0.35 : 0.85;
  const baseAng = Math.atan2(ty, tx);
  const arms = [-0.85, 0, 0.85];
  let bestAng = baseAng;
  let forkScore = -1e9;
  let altAng = baseAng;
  let forkAlt = -1e9;
  for (const arm of arms) {
    const ang = baseAng + arm;
    const px = c.x + Math.cos(ang) * scale * 0.62;
    const py = c.y + Math.sin(ang) * scale * 0.62;
    const e = escape2(px, py, maxIter, julia);
    const edgeNess = e.escaped ? Math.sin((Math.PI * Math.min(e.n, maxIter)) / maxIter) : 0.12;
    const qx = px + Math.cos(ang + Math.PI / 2) * scale * 0.2;
    const qy = py + Math.sin(ang + Math.PI / 2) * scale * 0.2;
    const q = escape2(qx, qy, maxIter, julia);
    let score = edgeNess * 5 + Math.abs(e.n - q.n);
    if ((c.hold ?? 0) > 0) score -= Math.abs(arm) * 1.4;
    if (score > forkScore) {
      altAng = bestAng;
      forkAlt = forkScore;
      bestAng = ang;
      forkScore = score;
    } else if (score > forkAlt) {
      altAng = ang;
      forkAlt = score;
    }
  }
  let hold = Math.max(0, (c.hold ?? 0) - dt);
  let chosen = bestAng;
  let gap = Math.abs(bestAng - altAng);
  gap = Math.min(gap, Math.PI * 2 - gap);
  if (hold <= 0 && forkAlt > 1.1 && gap > 0.35 && forkScore - forkAlt < 1.6) {
    chosen = forkBit(c.x, c.y, 0) ? bestAng : altAng;
    hold = 0.85;
  }
  const dirx = Math.cos(chosen);
  const diry = Math.sin(chosen);
  const desiredVx = (dirx * along + rx * pull) * scale;
  const desiredVy = (diry * along + ry * pull) * scale;
  let vx = dampVel(c.vx, desiredVx, dt, 3.2);
  let vy = dampVel(c.vy, desiredVy, dt, 3.2);
  const step = Math.hypot(vx, vy) * dt;
  const cap = scale * 0.16;
  if (step > cap) {
    const k = cap / step;
    vx *= k;
    vy *= k;
  }
  const heading = Math.hypot(vx, vy) > scale * 0.002 ? Math.atan2(vy, vx) : c.heading;
  return { x: c.x + vx * dt, y: c.y + vy * dt, vx, vy, heading, hold };
}

export function referenceOrbit(
  cx: number,
  cy: number,
  count: number,
  julia?: JuliaConst,
): Array<[number, number]> {
  const n = Math.max(0, Math.min(ORBIT_MAX, count | 0));
  const zs: Array<[number, number]> = [];
  let zx = julia ? cx : 0;
  let zy = julia ? cy : 0;
  const cr = julia ? julia.x : cx;
  const ci = julia ? julia.y : cy;
  for (let i = 0; i < n; i++) {
    zs.push([zx, zy]);
    const mag = zx * zx + zy * zy;
    if (mag > 64) break;
    const nx = zx * zx - zy * zy + cr;
    zy = 2 * zx * zy + ci;
    zx = nx;
  }
  return zs;
}

/** Perturbation iterate. Returns the smooth escape of cref + (dcx, dcy). */
export function perturbEscape(
  orbit: ReadonlyArray<readonly [number, number]>,
  dcx: number,
  dcy: number,
  julia: boolean,
): EscapeSample {
  let dx = julia ? dcx : 0;
  let dy = julia ? dcy : 0;
  let trap = 1e9;
  for (let i = 0; i < orbit.length; i++) {
    const Z = orbit[i]!;
    const zx = Z[0] + dx;
    const zy = Z[1] + dy;
    const mag = zx * zx + zy * zy;
    if (mag < trap) trap = mag;
    if (mag > 64 && i > 0) {
      const smooth = i + 1 - Math.log2(Math.log2(Math.max(mag, 1.0001)));
      return { n: smooth, trap, escaped: true };
    }
    const ndx = 2 * (Z[0] * dx - Z[1] * dy) + (dx * dx - dy * dy) + (julia ? 0 : dcx);
    const ndy = 2 * (Z[0] * dy + Z[1] * dx) + (2 * dx * dy) + (julia ? 0 : dcy);
    dx = ndx;
    dy = ndy;
  }
  return { n: orbit.length, trap, escaped: false };
}

export function packOrbit(zs: ReadonlyArray<readonly [number, number]>): number[][] {
  const buffers: number[][] = [];
  for (let b = 0; b < ORBIT_BUFFERS; b++) {
    const row = new Array<number>(ORBIT_STRIDE * 2).fill(0);
    for (let i = 0; i < ORBIT_STRIDE; i++) {
      const z = zs[b * ORBIT_STRIDE + i];
      if (!z) break;
      row[i * 2] = z[0];
      row[i * 2 + 1] = z[1];
    }
    buffers.push(row);
  }
  return buffers;
}

export interface Nucleus {
  x: number;
  y: number;
  size: number;
}

/** Period-p nucleus near c, plus the conformal size 1/|dz/dc|. */
export function newtonNucleus(cx: number, cy: number, period: number): Nucleus | null {
  if (period < 1 || period > 64) return null;
  let x = cx;
  let y = cy;
  let dx = 0;
  let dy = 0;
  for (let k = 0; k < 10; k++) {
    let zx = 0;
    let zy = 0;
    dx = 0;
    dy = 0;
    let escaped = false;
    for (let n = 0; n < period; n++) {
      const ndx = 2 * (zx * dx - zy * dy) + 1;
      const ndy = 2 * (zx * dy + zy * dx);
      const nzx = zx * zx - zy * zy + x;
      const nzy = 2 * zx * zy + y;
      zx = nzx;
      zy = nzy;
      dx = ndx;
      dy = ndy;
      if (zx * zx + zy * zy > 64) {
        escaped = true;
        break;
      }
    }
    if (escaped) return null;
    const ddx = dx - 1;
    const ddy = dy;
    const den = ddx * ddx + ddy * ddy;
    if (den < 1e-24) return null;
    const qx = (zx * ddx + zy * ddy) / den;
    const qy = (zy * ddx - zx * ddy) / den;
    x -= qx;
    y -= qy;
    if (qx * qx + qy * qy < 1e-24) break;
  }
  const der = Math.hypot(dx, dy);
  if (!(der > 1e-8) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, size: 1 / der };
}

function guessPeriod(cx: number, cy: number): number | null {
  let zx = 0;
  let zy = 0;
  let bestP = 0;
  let best = 1e9;
  for (let n = 1; n <= 48; n++) {
    const nx = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = nx;
    const mag = zx * zx + zy * zy;
    if (mag > 64) break;
    if (mag < best) {
      best = mag;
      bestP = n;
    }
  }
  return bestP >= 1 && best < 0.04 ? bestP : null;
}

export interface ChartFix {
  x: number;
  y: number;
  scale: number;
}

/**
 * When a minibrot fills the window, rewrite the view in that copy's chart.
 * Coordinates return to O(1) with full precision, and the zoom continues.
 */
export function tryRenormalize(x: number, y: number, scale: number): ChartFix | null {
  if (!(scale > 0) || scale > 0.05) return null;
  const radii = [0, 0.25, 0.55, 0.9];
  for (const r of radii) {
    const probes = r === 0 ? 1 : 8;
    for (let i = 0; i < probes; i++) {
      const ang = (i / probes) * Math.PI * 2;
      const px = x + Math.cos(ang) * scale * r;
      const py = y + Math.sin(ang) * scale * r;
      const period = guessPeriod(px, py);
      if (!period) continue;
      const nuc = newtonNucleus(px, py, period);
      if (!nuc || !(nuc.size > 0)) continue;
      if (nuc.size > scale * 3 || nuc.size < scale * 0.05) continue;
      const nucDist = Math.hypot(x - nuc.x, y - nuc.y);
      if (nucDist > scale * 1.35) continue;
      const ns = scale / nuc.size;
      if (ns < 0.3 || ns > 3.2) continue;
      const nx = (x - nuc.x) / nuc.size;
      const ny = (y - nuc.y) / nuc.size;
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || Math.hypot(nx, ny) > 6) continue;
      return { x: nx, y: ny, scale: ns };
    }
  }
  return null;
}

export interface DeParams {
  power: number;
  scale: number;
  fold: number;
  sym: number;
  jx: number;
  jy: number;
  jz: number;
  jw: number;
}

export function de3(kind: number, x: number, y: number, z: number, p: DeParams): number {
  if (kind < 0.5) return bulbDe(x, y, z, p.power);
  if (kind < 1.5) return boxDe(x, y, z, p.scale, p.fold);
  if (kind < 2.5) return mengerDe(x, y, z);
  if (kind < 3.5) return sierpDe(x, y, z);
  if (kind < 4.5) return julia4De(x, y, z, p);
  return kaleidoDe(x, y, z, p.sym);
}

function bulbDe(x: number, y: number, z: number, power: number): number {
  const pow = Math.max(2, power);
  let zx = x;
  let zy = y;
  let zz = z;
  let dr = 1;
  let r = 0;
  for (let i = 0; i < 22; i++) {
    r = Math.hypot(zx, zy, zz);
    if (r > 4 || r < 1e-8) break;
    const theta = Math.acos(Math.min(1, Math.max(-1, zz / r)));
    const phi = Math.atan2(zy, zx);
    dr = Math.pow(r, pow - 1) * pow * dr + 1;
    const th = theta * pow;
    const ph = phi * pow;
    const nr = Math.pow(r, pow);
    zx = nr * Math.sin(th) * Math.cos(ph) + x;
    zy = nr * Math.sin(ph) * Math.sin(th) + y;
    zz = nr * Math.cos(th) + z;
  }
  return (0.5 * Math.log(Math.max(r, 1e-4)) * r) / Math.max(dr, 1e-4);
}

function boxDe(x: number, y: number, z: number, scale: number, fold: number): number {
  let zx = x;
  let zy = y;
  let zz = z;
  const s = scale;
  for (let i = 0; i < 16; i++) {
    zx = Math.min(1, Math.max(-1, zx)) * 2 - zx;
    zy = Math.min(1, Math.max(-1, zy)) * 2 - zy;
    zz = Math.min(1, Math.max(-1, zz)) * 2 - zz;
    const r2 = zx * zx + zy * zy + zz * zz;
    if (r2 < 0.25) {
      zx *= 4; zy *= 4; zz *= 4;
    } else if (r2 < 1) {
      zx /= r2; zy /= r2; zz /= r2;
    }
    zx = zx * s + x;
    zy = zy * s + y;
    zz = zz * s + z;
  }
  return (Math.hypot(zx, zy, zz) - 1) * fold;
}

function mengerDe(x: number, y: number, z: number): number {
  let d = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - 1;
  let s = 1;
  for (let i = 0; i < 6; i++) {
    const ax = Math.abs((x * s) % 2 - 1);
    const ay = Math.abs((y * s) % 2 - 1);
    const az = Math.abs((z * s) % 2 - 1);
    s *= 3;
    const rx = Math.abs(1 - 3 * ax);
    const ry = Math.abs(1 - 3 * ay);
    const rz = Math.abs(1 - 3 * az);
    const c = (Math.min(Math.max(rx, ry), Math.max(ry, rz), Math.max(rz, rx)) - 1) / s;
    d = Math.max(d, c);
  }
  return d;
}

function sierpDe(x: number, y: number, z: number): number {
  let s = 1;
  let d = 1e9;
  let px = x;
  let py = y;
  let pz = z;
  for (let i = 0; i < 8; i++) {
    if (px + py < 0) { const t = px; px = -py; py = -t; }
    if (px + pz < 0) { const t = px; px = -pz; pz = -t; }
    if (py + pz < 0) { const t = py; py = -pz; pz = -t; }
    px = px * 2 - 1;
    py = py * 2 - 1;
    pz = pz * 2 - 1;
    s *= 2;
    d = Math.min(d, (Math.hypot(px, py, pz) - 0.35) / s);
  }
  return d;
}

function julia4De(x: number, y: number, z: number, p: DeParams): number {
  let zx = x;
  let zy = y;
  let zz = z;
  let zw = 0.2;
  let dr = 1;
  let r = 0;
  for (let i = 0; i < 16; i++) {
    r = Math.hypot(zx, zy, zz, zw);
    if (r > 4) break;
    dr = 2 * r * dr + 1;
    const nx = zx * zx - (zy * zy + zz * zz + zw * zw) + p.jx;
    const ny = 2 * zx * zy + p.jy;
    const nz = 2 * zx * zz + p.jz;
    const nw = 2 * zx * zw + p.jw;
    zx = nx; zy = ny; zz = nz; zw = nw;
  }
  return (0.5 * Math.log(Math.max(r, 1e-4)) * r) / Math.max(dr, 1e-4);
}

function kaleidoDe(x: number, y: number, z: number, sym: number): number {
  let a = Math.atan2(y, x);
  const r = Math.hypot(x, y);
  const sector = (Math.PI * 2) / Math.max(sym, 3);
  a = ((a % sector) + sector) % sector - sector * 0.5;
  const qx = Math.cos(a) * r;
  const qy = Math.sin(a) * r;
  const px = Math.abs(qx) - 0.35;
  const py = Math.abs(qy) - 0.35;
  const pz = Math.abs(z) - 0.2;
  const ox = Math.max(px, 0);
  const oy = Math.max(py, 0);
  const oz = Math.max(pz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(px, py, pz), 0) - 0.08;
}

export interface Canyon3 {
  fx: number;
  fy: number;
  fz: number;
  cx: number;
  cy: number;
  cz: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  near: number;
  /** Seconds committed to the current fork. */
  hold?: number;
}

export const CANYON_HOME: Canyon3 = {
  fx: 0.42, fy: 0.58, fz: 0.18,
  cx: 0.12, cy: 0.22, cz: 2.42,
  vx: 0, vy: 0, vz: 0,
  heading: 0.4,
  near: 0,
  hold: 0,
};

/**
 * Fly just off the distance field. Several headings are scored as corridors;
 * when two of them both hug the surface, the run commits to one branch.
 */
export function stepCanyon(c: Canyon3, dt: number, kind: number, params: DeParams, _zoomLog: number): Canyon3 {
  if (!(dt > 0)) return c;
  const dist = de3(kind, c.fx, c.fy, c.fz, params);
  if (!Number.isFinite(dist)) return c;
  const clearance = 0.04;
  const eps = 0.012;
  const gx = de3(kind, c.fx + eps, c.fy, c.fz, params) - de3(kind, c.fx - eps, c.fy, c.fz, params);
  const gy = de3(kind, c.fx, c.fy + eps, c.fz, params) - de3(kind, c.fx, c.fy - eps, c.fz, params);
  const gz = de3(kind, c.fx, c.fy, c.fz + eps, params) - de3(kind, c.fx, c.fy, c.fz - eps, params);
  const gl = Math.hypot(gx, gy, gz) || 1;
  const nx = gx / gl;
  const ny = gy / gl;
  const nz = gz / gl;
  let tx = -nz;
  let ty = 0;
  let tz = nx;
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-4) {
    tx = 1; ty = 0; tz = 0;
  } else {
    tx /= tl; ty /= tl; tz /= tl;
  }
  const sx = ny * tz - nz * ty;
  const sy = nz * tx - nx * tz;
  const sz = nx * ty - ny * tx;
  const look = 0.085;
  const offsets = [-1.05, -0.48, 0, 0.48, 1.05];
  const arms: { ang: number; score: number; dx: number; dy: number; dz: number }[] = [];
  for (const off of offsets) {
    const ang = c.heading + off;
    const dx = Math.cos(ang) * tx + Math.sin(ang) * sx;
    const dy = Math.cos(ang) * ty + Math.sin(ang) * sy;
    const dz = Math.cos(ang) * tz + Math.sin(ang) * sz;
    const d = de3(kind, c.fx + dx * look, c.fy + dy * look, c.fz + dz * look, params);
    if (!Number.isFinite(d)) continue;
    let score = 1.35 - Math.abs(d - clearance) / clearance;
    if (d < clearance * 0.22) score -= 2.4;
    if (d > clearance * 7) score -= 1.7;
    if ((c.hold ?? 0) > 0) score -= Math.abs(off) * 0.7;
    arms.push({ ang, score, dx, dy, dz });
  }
  arms.sort((a, b) => b.score - a.score);
  const topN = arms.slice(0, 2);
  for (const arm of topN) {
    const qx = ny * arm.dz - nz * arm.dy;
    const qy = nz * arm.dx - nx * arm.dz;
    const qz = nx * arm.dy - ny * arm.dx;
    const ql = Math.hypot(qx, qy, qz) || 1;
    const side = 0.065;
    const px = c.fx + arm.dx * look;
    const py = c.fy + arm.dy * look;
    const pz = c.fz + arm.dz * look;
    const left = de3(kind, px - (qx / ql) * side, py - (qy / ql) * side, pz - (qz / ql) * side, params);
    const right = de3(kind, px + (qx / ql) * side, py + (qy / ql) * side, pz + (qz / ql) * side, params);
    const tight = Math.min(left, right);
    const open = Math.max(left, right);
    if (Number.isFinite(tight) && Number.isFinite(open) && tight < clearance * 1.4 && open > tight * 1.7) {
      arm.score += 0.9;
    }
  }
  topN.sort((a, b) => b.score - a.score);
  const best = topN[0] ?? { ang: c.heading, score: 0 };
  const alt = topN[1] ?? best;
  let hold = Math.max(0, (c.hold ?? 0) - dt);
  let chosen = best.ang;
  let gap = Math.abs(best.ang - alt.ang);
  gap = Math.min(gap, Math.PI * 2 - gap);
  if (hold <= 0 && alt.score > 0.15 && gap > 0.42 && best.score - alt.score < 0.6) {
    chosen = forkBit(c.fx, c.fy, c.fz) ? best.ang : alt.ang;
    hold = 1.2;
  }
  const heading = dampAngle(c.heading, chosen, dt, 2.2);
  const slide = Math.cos(heading) * tx + Math.sin(heading) * sx;
  const slideY = Math.cos(heading) * ty + Math.sin(heading) * sy;
  const slideZ = Math.cos(heading) * tz + Math.sin(heading) * sz;
  const push = Math.max(-0.22, Math.min(0.22, clearance - dist));
  const speed = 0.16;
  const rad = Math.hypot(c.fx, c.fy, c.fz) || 1;
  const basin = rad > 1.35 ? (rad - 1.35) * 0.85 : 0;
  let vx = dampVel(c.vx, slide * speed + nx * push * 2.4 - (c.fx / rad) * basin, dt, 2.8);
  let vy = dampVel(c.vy, slideY * speed + ny * push * 2.4 - (c.fy / rad) * basin, dt, 2.8);
  let vz = dampVel(c.vz, slideZ * speed + nz * push * 2.4 - (c.fz / rad) * basin, dt, 2.8);
  const step = Math.hypot(vx, vy, vz) * dt;
  if (step > 0.016) {
    const k = 0.016 / step;
    vx *= k; vy *= k; vz *= k;
  }
  const fx = c.fx + vx * dt;
  const fy = c.fy + vy * dt;
  const fz = c.fz + vz * dt;
  const eye = 0.12;
  const lift = clearance * 1.15;
  const cx = fx - slide * eye + nx * lift;
  const cy = fy - slideY * eye + ny * lift;
  const cz = fz - slideZ * eye + nz * lift;
  const near = Math.hypot(fx - cx, fy - cy, fz - cz);
  return { fx, fy, fz, cx, cy, cz, vx, vy, vz, heading, near, hold };
}
