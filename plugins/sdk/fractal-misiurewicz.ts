/**
 * Self-similar loop points for an infinite, seamless planar zoom.
 *
 * Mandelbrot: near a Misiurewicz point c0 (0 lands on a repelling cycle after k steps) the set is
 * asymptotically self-similar: c0 + w in M  <=>  c0 + lambda*w in M, where lambda is the cycle's
 * multiplier. Julia: the same holds exactly at a repelling periodic point of f_c. So a view at
 * (scale s, rotation phi) matches the view at (s*|lambda|, phi + arg lambda): a zoom that has gone
 * in by |lambda| can jump back out and rotate, and the frame does not change. Depth stays bounded,
 * so float precision never runs out.
 */
import { type JuliaConst, escape2, itersForScale } from "./fractal-cruise";
import { FZ_BAND_K } from "./fractal-slot";

export interface LoopPoint {
  x: number;
  y: number;
  /** |lambda| and arg(lambda): zoom-in factor per loop and the rotation that matches it. */
  mag: number;
  arg: number;
  pre: number;
  period: number;
}

/** Loops narrower than this barely move; wider ones need too many iterations per loop. */
export const LOOP_MAG_MIN = 1.6;
export const LOOP_MAG_MAX = 48;

const MAX_ORBIT = 64;
const MAX_PERIOD = 6;

/** The forward orbit from the critical point (Mandelbrot) or from z0 (Julia): z_1 .. z_n. */
function forward(x: number, y: number, n: number, julia?: JuliaConst): Array<[number, number]> | null {
  let zx = julia ? x : 0;
  let zy = julia ? y : 0;
  const cr = julia ? julia.x : x;
  const ci = julia ? julia.y : y;
  const out: Array<[number, number]> = julia ? [[zx, zy]] : [];
  while (out.length < n) {
    const nx = zx * zx - zy * zy + cr;
    zy = 2 * zx * zy + ci;
    zx = nx;
    if (zx * zx + zy * zy > 16 || !Number.isFinite(zx + zy)) return null;
    out.push([zx, zy]);
  }
  return out;
}

/** Smallest (pre, period) with z_{pre+period} = z_pre, and the cycle multiplier, or null. */
export function classifyLoop(x: number, y: number, julia?: JuliaConst): LoopPoint | null {
  const zs = forward(x, y, MAX_ORBIT, julia);
  if (!zs) return null;
  const tol = 1e-9;
  for (let total = 1; total < MAX_ORBIT; total++) {
    for (let p = 1; p <= Math.min(MAX_PERIOD, total); p++) {
      const k = total - p;
      const a = zs[k]!;
      const b = zs[k + p]!;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > tol * Math.max(1, Math.hypot(a[0], a[1]))) continue;
      let lx = 1;
      let ly = 0;
      for (let j = k; j < k + p; j++) {
        const [zx, zy] = zs[j]!;
        const nx = lx * 2 * zx - ly * 2 * zy;
        ly = lx * 2 * zy + ly * 2 * zx;
        lx = nx;
      }
      const mag = Math.hypot(lx, ly);
      return { x, y, mag, arg: Math.atan2(ly, lx), pre: k, period: p };
    }
  }
  return null;
}

/** Newton on z_{k+p} - z_k = 0 (in c for Mandelbrot, in z0 for Julia) from one seed. */
function newton(sx: number, sy: number, k: number, p: number, julia?: JuliaConst): [number, number] | null {
  let x = sx;
  let y = sy;
  for (let it = 0; it < 24; it++) {
    let zx = julia ? x : 0;
    let zy = julia ? y : 0;
    let dx = julia ? 1 : 0;
    let dy = 0;
    let mx = 0;
    let my = 0;
    let mdx = 0;
    let mdy = 0;
    const cr = julia ? julia.x : x;
    const ci = julia ? julia.y : y;
    for (let j = 1; j <= k + p; j++) {
      // dz' = 2 z dz (+ 1 for Mandelbrot, where c is the variable)
      const ndx = 2 * (zx * dx - zy * dy) + (julia ? 0 : 1);
      const ndy = 2 * (zx * dy + zy * dx);
      const nzx = zx * zx - zy * zy + cr;
      zy = 2 * zx * zy + ci;
      zx = nzx;
      dx = ndx;
      dy = ndy;
      if (zx * zx + zy * zy > 1e12) return null;
      if (j === k) {
        mx = zx;
        my = zy;
        mdx = dx;
        mdy = dy;
      }
    }
    if (k === 0) {
      // Julia periodic point: z_p - z_0
      mx = x;
      my = y;
      mdx = 1;
      mdy = 0;
    }
    const gx = zx - mx;
    const gy = zy - my;
    const gdx = dx - mdx;
    const gdy = dy - mdy;
    const den = gdx * gdx + gdy * gdy;
    if (!(den > 1e-300)) return null;
    const qx = (gx * gdx + gy * gdy) / den;
    const qy = (gy * gdx - gx * gdy) / den;
    x -= qx;
    y -= qy;
    if (Math.hypot(qx, qy) < 1e-15 * Math.max(1, Math.hypot(x, y))) break;
  }
  return Number.isFinite(x + y) ? [x, y] : null;
}

/**
 * Fraction of a coarse grid that would look different across a jump: the view just before (scale
 * s/|lambda|, rotation phi) against just after (scale s, phi + arg), comparing inside/outside and the
 * colour band the sky paints. The jump lowers every escape count by the period and the drive adds
 * it back (FZ_SLOT.iterShift), so the band compares n against n' + period. Small means seamless.
 */
export function loopMismatch(pt: LoopPoint, scale: number, phi: number, julia?: JuliaConst, aspect = 1.6): number {
  const inner = scale / pt.mag;
  const it = Math.min(400, Math.max(48, itersForScale(inner) + 24));
  let bad = 0;
  let n = 0;
  const at = (s: number, rot: number, u: number, v: number) => {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    return escape2(pt.x + s * (u * cr - v * sr), pt.y + s * (u * sr + v * cr), it, julia);
  };
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 14; i++) {
      const u = ((i + 0.5) / 14 - 0.5) * 2 * aspect * 0.6;
      const v = ((j + 0.5) / 9 - 0.5) * 2 * 0.6;
      const a = at(inner, phi, u, v);
      const b = at(scale, phi + pt.arg, u, v);
      n += 1;
      if (a.escaped !== b.escaped) {
        bad += 1;
        continue;
      }
      if (!a.escaped) continue;
      const d = Math.abs(a.n - (b.n + pt.period)) * FZ_BAND_K;
      const wrapped = d % 2;
      if (Math.min(wrapped, 2 - wrapped) > 0.15) bad += 1;
    }
  }
  return bad / n;
}

export interface LoopTarget extends LoopPoint {
  /** Largest window at which one loop is seamless (loopMismatch under the limit). */
  sTop: number;
}

const TOP_LADDER = [0.06, 0.03, 0.015, 0.008, 0.004, 0.002, 0.001];

/**
 * Low-preperiod loop points across the whole set (Mandelbrot) or Julia set, each with the widest
 * seamless window. Shallow points stay self-similar at comfortable scales, so a loop never needs more
 * iterations or precision than the float GPU path has. Deterministic; compute once per set.
 */
export function loopCatalogue(julia?: JuliaConst, maxMismatch = 0.04): LoopTarget[] {
  const out: LoopTarget[] = [];
  const box = julia ? { x0: -1.6, x1: 1.6, y0: -1.2, y1: 1.2 } : { x0: -2.05, x1: 0.55, y0: -1.2, y1: 1.2 };
  const GRID = 48;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const sx = box.x0 + ((gx + 0.5) / GRID) * (box.x1 - box.x0);
      const sy = box.y0 + ((gy + 0.5) / GRID) * (box.y1 - box.y0);
      const e = escape2(sx, sy, 40, julia);
      // Seeds on the boundary band only: interior seeds converge to centres, far exterior ones diverge.
      if (!e.escaped || e.n < 6) continue;
      const kLo = julia ? 0 : 2;
      const kHi = julia ? 0 : Math.min(7, Math.floor(e.n));
      for (let k = kLo; k <= kHi; k++) {
        for (let p = 1; p <= (julia ? 6 : 3); p++) {
          const root = newton(sx, sy, k, p, julia);
          if (!root) continue;
          const [x, y] = root;
          if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 1e-7)) continue;
          const pt = classifyLoop(x, y, julia);
          if (!pt || pt.mag < LOOP_MAG_MIN || pt.mag > LOOP_MAG_MAX) continue;
          const sTop = TOP_LADDER.find((s) => loopMismatch(pt, s, 0, julia) <= maxMismatch);
          if (sTop === undefined) continue;
          out.push({ ...pt, sTop });
        }
      }
    }
  }
  // Widest seamless band first, then nicer zoom steps (|lambda| near 4..10 reads best).
  out.sort((a, b) => b.sTop - a.sTop || Math.abs(Math.log(a.mag / 6)) - Math.abs(Math.log(b.mag / 6)));
  return out;
}

/** Orbit of the loop point for perturbation: it never escapes, so any length is exact. */
export function loopReferenceOrbit(pt: LoopPoint, count: number, julia?: JuliaConst): Array<[number, number]> {
  const zs: Array<[number, number]> = [];
  let zx = julia ? pt.x : 0;
  let zy = julia ? pt.y : 0;
  const cr = julia ? julia.x : pt.x;
  const ci = julia ? julia.y : pt.y;
  for (let i = 0; i < count; i++) {
    zs.push([zx, zy]);
    const nx = zx * zx - zy * zy + cr;
    zy = 2 * zx * zy + ci;
    zx = nx;
  }
  return zs;
}
