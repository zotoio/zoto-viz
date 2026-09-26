/**
 * One stereogram frame, built once on the CPU and handed to the sky as a flat
 * list of world-space parts. The shader only finds depth along each row and
 * draws the pattern. Building parts per pixel cost about 8 ms of GPU a frame
 * and an 8 s shader compile on an RTX 4090.
 *
 * Buffer slots 1–6 hold up to 48 parts, two vec4 each:
 *   capsule, ball or dent  A = (a.xyz, radius)               B = (b.xyz, bulge; < 0 is a dent)
 *   block                  A = (centre.xyz, screen half-width) B = (half size.xyz, 4)
 * Slot 7 is the header:
 *   (parts, room A, room B, room mix), (fine, palette A, palette B, palette mix),
 *   (repeat in view units, bands per repeat, band multiplier while moving, 0).
 *
 * Units are view-tangent coordinates: x across, y up, z toward the eye.
 */

import { STEREO_BINS, STEREO_DEPTH, type StereoTiming } from "./drive";
import type { StereoSceneFrame } from "./recipe";

export const STEREO_FRAME_PARTS = 48;
/** Buffer slots 1–7. */
export const STEREO_FRAME_SLOTS = 7;
const SLOT_FLOATS = 64;
const HEAD = 6 * SLOT_FLOATS;

/** Keep in step with fragment.glsl. */
export const STEREO_Z_RANGE = 0.6;
export const STEREO_RELIEF = 1.4;
/** A block's code in B.w. */
export const STEREO_BLOCK = 4;

type V3 = [number, number, number];
/** Column-major, like GLSL. */
type M3 = number[];

interface Part { a: V3; b: V3; r: number; g: number }

const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rotX(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; }
function rotY(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
function rotZ(a: number): M3 { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; }

function mul(A: M3, B: M3): M3 {
  const o = new Array<number>(9);
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) o[j * 3 + i] = A[i]! * B[j * 3]! + A[3 + i]! * B[j * 3 + 1]! + A[6 + i]! * B[j * 3 + 2]!;
  }
  return o;
}

function mv(M: M3, v: V3): V3 {
  return [
    M[0]! * v[0] + M[3]! * v[1] + M[6]! * v[2],
    M[1]! * v[0] + M[4]! * v[1] + M[7]! * v[2],
    M[2]! * v[0] + M[5]! * v[1] + M[8]! * v[2],
  ];
}

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const mix3 = (a: V3, b: V3, s: number): V3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
const mix = (a: number, b: number, s: number): number => a + (b - a) * s;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const fract = (v: number): number => v - Math.floor(v);
const mod = (v: number, m: number): number => v - m * Math.floor(v / m);
const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The one three-quarter view every block is seen from, so its top and right side show. */
const ISO = mul(rotX(0.35), rotY(-0.6));
const isoRow = (r: number): V3 => [Math.abs(ISO[r]!), Math.abs(ISO[3 + r]!), Math.abs(ISO[6 + r]!)];
const ISO_X = isoRow(0);
const ISO_Z = isoRow(2);
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Half a block's depth span, so a centre at rest - boxBack keeps its mean surface at rest. */
const boxBack = (h: V3): number => 0.5 * dot3(ISO_Z, h);

class Builder {
  readonly out: Part[] = [];
  private stored: Part[] = [];
  /** 0 draw, 1 store the outgoing object, 2 morph into what was stored. */
  mode = 0;
  mixS = 0;
  private slot = 0;
  private ca: V3 = [0, 0, 0];
  C: V3 = [0, 0, 0.3];
  M: M3 = I3;
  T: M3 = I3;
  SC = 1;

  reset(): void {
    this.C = [0, 0, 0.3];
    this.M = I3;
    this.SC = 1;
  }

  private put(a: V3, b: V3, r: number, g: number): void {
    if (r <= 0 || this.out.length >= STEREO_FRAME_PARTS) return;
    this.out.push({ a, b, r, g });
  }

  // A dent never blends into a bump: one shrinks to nothing, then the other grows.
  private blendPut(p: Part, a: V3, b: V3, r: number, g: number): void {
    const s = this.mixS;
    const ma = mix3(p.a, a, s);
    const mb = mix3(p.b, b, s);
    if ((p.g < 0) === (g < 0)) this.put(ma, mb, mix(p.r, r, s), mix(p.g, g, s));
    else if (s < 0.5) this.put(ma, mb, p.r * (1 - 2 * s), p.g);
    else this.put(ma, mb, r * (2 * s - 1), g);
  }

  /** Object pose M, then the turntable T, both about the object's centre C. */
  add(a: V3, b: V3, r: number, g: number): void {
    const wa = add3(this.C, mv(this.T, mv(this.M, scale3(a, this.SC))));
    const wb = add3(this.C, mv(this.T, mv(this.M, scale3(b, this.SC))));
    const wr = r * this.SC;
    if (this.mode === 1) {
      if (this.stored.length < STEREO_FRAME_PARTS) this.stored.push({ a: wa, b: wb, r: wr, g });
    } else if (this.mode === 2) {
      const from = this.stored[this.slot] ?? { a: this.ca, b: this.ca, r: 0, g };
      this.blendPut(from, wa, wb, wr, g);
      this.slot++;
    } else {
      this.put(wa, wb, wr, g);
    }
  }

  ball(c: V3, r: number): void { this.add(c, c, r, 1); }
  dent(c: V3, r: number): void { this.add(c, c, r, -1); }

  /** A solid block of half size h about world centre c, seen from ISO. */
  box(c: V3, h: V3): void {
    if (Math.min(h[0], h[1]) <= 0) return;
    this.put(c, h, dot3(ISO_X, h), STEREO_BLOCK);
  }

  /** After the outgoing object is stored: morph the incoming one into it. */
  beginMorph(): void {
    this.ca = this.C;
    this.mode = 2;
    this.slot = 0;
  }

  /** Parts the outgoing object had beyond the incoming one's shrink into its centre. */
  finishMorph(): void {
    const s = this.mixS;
    for (let i = this.slot; i < this.stored.length; i++) {
      const p = this.stored[i]!;
      this.put(mix3(p.a, this.C, s), mix3(p.b, this.C, s), p.r * (1 - s), p.g);
    }
  }
}

function ringObj(B: Builder, u: number): void {
  const R = 0.2;
  const x = 0.38 * (smoothstep(0, 0.2, u) - 2 * smoothstep(0.2, 0.45, u) + smoothstep(0.45, 0.6, u));
  const s = smoothstep(0.58, 1, u);
  B.C = [x, -0.06, 0.3];
  B.M = mul(rotY(37.699112 * s * (2 - s)), rotZ(-x / R));
  let prev: V3 = [R, 0, 0];
  for (let i = 1; i <= 18; i++) {
    const a = i * 0.34906585;
    const q: V3 = [R * Math.cos(a), R * Math.sin(a), 0];
    B.add(prev, q, 0.05, 1);
    prev = q;
  }
  B.add([-0.03, R + 0.02, 0], [0.03, R + 0.02, 0], 0.032, 1);
  B.ball([0, R + 0.08, 0], 0.06);
}

function bump(u: number, c: number): number { const k = (u - c) * 40; return Math.exp(-k * k); }

function skullObj(B: Builder, t: number, u: number, act: number): void {
  const talk = smoothstep(0.06, 0.1, u) - smoothstep(0.36, 0.4, u)
    + smoothstep(0.45, 0.49, u) - smoothstep(0.72, 0.76, u)
    + smoothstep(0.8, 0.84, u) - smoothstep(0.93, 0.96, u);
  const yaw = -0.45 * smoothstep(0.02, 0.1, u) + 0.9 * smoothstep(0.38, 0.47, u) - 0.45 * smoothstep(0.74, 0.82, u);
  const nod = 0.12 * (bump(u, 0.41) + bump(u, 0.77) + bump(u, 0.965));
  const open = 0.03 + talk * (0.14 + 0.22 * act) * (0.5 + 0.5 * Math.sin(t * 12 + 2 * Math.sin(t * 4.3)));
  B.C = [0, 0, 0.28];
  B.M = mul(rotY(yaw), rotX(nod - 0.1 * open));
  B.SC = 1.15;
  B.ball([0, 0.09, -0.04], 0.21);
  B.ball([0, 0.03, 0.04], 0.16);
  B.ball([-0.1, -0.06, 0.05], 0.07);
  B.ball([0.1, -0.06, 0.05], 0.07);
  B.add([-0.06, -0.12, 0.07], [0.06, -0.12, 0.07], 0.055, 1);
  B.dent([-0.072, 0, 0.2], 0.07);
  B.dent([0.072, 0, 0.2], 0.07);
  B.dent([-0.014, -0.075, 0.17], 0.032);
  B.dent([0.014, -0.075, 0.17], 0.032);
  const hinge: V3 = [0, -0.08, -0.04];
  const J = rotX(open);
  const jaw = (p: V3): V3 => add3(hinge, mv(J, sub3(p, hinge)));
  for (let i = 0; i < 6; i++) {
    const v = (i - 2.5) / 2.5;
    B.ball([v * 0.055, -0.158, 0.125 - 0.02 * v * v], 0.019);
    B.ball(jaw([v * 0.05, -0.182, 0.115 - 0.02 * v * v]), 0.017);
  }
  B.ball(jaw([0, -0.24, 0.08]), 0.058);
  for (const sx of [-1, 1]) B.add(jaw([sx * 0.11, -0.12, 0]), jaw([sx * 0.05, -0.225, 0.06]), 0.038, 1);
}

/** Curl: thumb (-1 up, 1 folded), index, middle, ring, pinky; then spread. */
const GEST = [
  0, 0, 0, 0, 0, 1,
  1, 1, 1, 1, 1, 0,
  1, 0, 1, 1, 1, 0.3,
  1, 0, 0, 1, 1, 1.4,
  1, 0, 0, 0, 1, 1,
  1, 0, 0, 0, 0, 1,
  -1, 1, 1, 1, 1, 0,
];
/** Open, fist, counts one to five, waves, thumbs up, open. */
const HKEY: [number, number][] = [[0, 0], [0.07, 1], [0.15, 2], [0.23, 3], [0.31, 4], [0.39, 5], [0.47, 0], [0.76, 6], [0.92, 0]];

function finger(B: Builder, base: V3, splay: number, len: V3, r: number, curl: number): void {
  let p = base;
  let phi = 0;
  const bends = [1.5, 1.7, 1.1];
  for (let k = 0; k < 3; k++) {
    phi += curl * bends[k]!;
    const d: V3 = [Math.sin(splay) * Math.cos(phi), Math.cos(splay) * Math.cos(phi), Math.sin(phi)];
    const q = add3(p, scale3(d, len[k]!));
    B.add(p, q, r * (1 - 0.12 * k), 1);
    p = q;
  }
}

function handObj(B: Builder, t: number, u: number): void {
  let k = 0;
  for (let i = 1; i < HKEY.length; i++) if (u >= HKEY[i]![0]) k = i;
  const g0 = HKEY[Math.max(k - 1, 0)]![1];
  const g1 = HKEY[k]![1];
  const f = smoothstep(HKEY[k]![0], HKEY[k]![0] + 0.035, u);
  const curl = Array.from({ length: 6 }, (_, j) => mix(GEST[g0 * 6 + j]!, GEST[g1 * 6 + j]!, f));
  const wave = smoothstep(0.5, 0.54, u) - smoothstep(0.7, 0.74, u);
  B.C = [0, -0.06, 0.28 + 0.2 * f * (1 - f) * (k >= 1 ? 1 : 0)];
  B.M = rotZ(0.35 * wave * Math.sin(t * 7));
  B.SC = 1.2;
  B.add([0, -0.1, -0.01], [0, -0.34, -0.02], 0.06, 1);
  B.add([-0.06, -0.07, 0], [0.06, -0.07, 0], 0.055, 0.9);
  B.add([-0.065, 0.02, 0], [0.065, 0.02, 0], 0.055, 0.9);
  B.add([-0.07, 0.09, 0], [0.07, 0.09, 0], 0.045, 0.9);
  const sp = curl[5]!;
  finger(B, [-0.057, 0.12, 0], -0.08 * sp, [0.08, 0.05, 0.04], 0.021, curl[1]!);
  finger(B, [-0.019, 0.125, 0], -0.02 * sp, [0.09, 0.055, 0.045], 0.022, curl[2]!);
  finger(B, [0.019, 0.12, 0], 0.05 * sp, [0.085, 0.05, 0.04], 0.021, curl[3]!);
  finger(B, [0.055, 0.11, 0], 0.12 * sp, [0.065, 0.04, 0.035], 0.018, curl[4]!);
  const th = curl[0]!;
  const dA = norm3(mix3(mix3([-0.8, 0.55, 0.25], [-0.2, 0.98, 0.05], Math.max(-th, 0)), [0.45, 0.3, 0.85], Math.max(th, 0)));
  const dB = norm3(mix3(mix3([-0.6, 0.78, 0.2], [0, 1, 0], Math.max(-th, 0)), [0.9, -0.2, 0.4], Math.max(th, 0)));
  const t0: V3 = [-0.075, -0.06, 0.03];
  const t1 = add3(t0, scale3(dA, 0.07));
  B.add(t0, t1, 0.029, 1);
  B.add(t1, add3(t1, scale3(dB, 0.055)), 0.024, 1);
}

function heartObj(B: Builder, t: number, act: number): void {
  const ph = fract(t * (58 + 50 * act) / 60);
  const lub = smoothstep(0, 0.05, ph) * Math.exp(-Math.max(ph - 0.05, 0) * 14);
  const dub = 0.55 * Math.exp(-(((ph - 0.26) * 12) ** 2));
  B.C = [0, -0.02, 0.28];
  B.M = rotZ(0.1);
  B.SC = 1.1 * (1 + 0.16 * (lub + dub));
  B.add([-0.03, 0.14, -0.02], [-0.05, 0.27, -0.04], 0.04, 1);
  B.add([-0.05, 0.27, -0.04], [-0.13, 0.29, -0.06], 0.03, 1);
  B.add([0.04, 0.15, -0.03], [0.11, 0.25, -0.05], 0.032, 1);
  B.ball([-0.085, 0.07, 0], 0.125);
  B.ball([0.085, 0.07, 0], 0.125);
  B.ball([0, -0.01, 0.02], 0.13);
  B.add([-0.11, 0.02, 0], [0, -0.2, 0], 0.075, 1);
  B.add([0.11, 0.02, 0], [0, -0.2, 0], 0.075, 1);
}

function helixObj(B: Builder, t: number, u: number): void {
  const w = smoothstep(0.1, 0.5, u) - smoothstep(0.62, 0.95, u);
  const fork = 0.47 - 0.94 * w;
  B.C = [0, -0.03, 0.3];
  B.M = rotZ(0.3);
  let pa: V3 = [0, 0, 0];
  let pb: V3 = [0, 0, 0];
  for (let i = 0; i <= 16; i++) {
    const y = -0.4 + i * 0.05;
    const o = smoothstep(fork - 0.06, fork + 0.06, y);
    const a = 0.6 * t + 3 * w + i * 0.5 * (1 - 0.6 * o);
    const qa: V3 = [0.13 * Math.cos(a) + 0.12 * o, y, 0.13 * Math.sin(a)];
    const qb: V3 = [-0.13 * Math.cos(a) - 0.12 * o, y, -0.13 * Math.sin(a)];
    if (i > 0) { B.add(pa, qa, 0.03, 1); B.add(pb, qb, 0.03, 1); }
    if (i % 2 === 0) B.add(qa, qb, 0.013 * (1 - o), 1);
    pa = qa;
    pb = qb;
  }
}

/** Butterfly keys (u, x, y): the flower, the far side, a loop, home. */
const BKEY: V3[] = [[0, 0, 0], [0.2, -0.42, 0.13], [0.42, -0.42, 0.13], [0.62, 0.42, -0.1], [0.8, 0.26, 0.18], [1, 0, 0]];

function bpath(u: number): [number, number] {
  let p: [number, number] = [BKEY[0]![1], BKEY[0]![2]];
  for (let i = 0; i < BKEY.length - 1; i++) {
    const a = BKEY[i]!;
    const b = BKEY[i + 1]!;
    if (u >= a[0]) {
      const s = smoothstep(a[0], b[0], u);
      p = [mix(a[1], b[1], s), mix(a[2], b[2], s)];
    }
  }
  return p;
}

function flyObj(B: Builder, t: number, u: number): void {
  B.C = [-0.42, 0.06, 0.16];
  B.add([0, -0.36, -0.04], [0, -0.02, 0], 0.012, 1);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.0471976;
    B.add([0, 0, 0], [0.06 * Math.cos(a), 0.06 * Math.sin(a), 0], 0.03, 0.3);
  }
  B.ball([0, 0, 0], 0.026);
  const p1 = bpath(Math.min(u + 0.03, 1));
  const p0 = bpath(Math.max(u - 0.03, 0));
  const v: [number, number] = [p1[0] - p0[0], p1[1] - p0[1]];
  const fly = smoothstep(0.005, 0.03, Math.hypot(v[0], v[1]));
  const flap = mix(0.6 + 0.45 * Math.sin(t * 1.3), 0.15 + 1.05 * (0.5 + 0.5 * Math.sin(t * 7)) ** 1.5, fly);
  const at = bpath(u);
  B.C = [at[0], at[1], 0.24 + 0.04 * fly];
  B.M = mul(rotZ(clamp(-v[0] * 6, -0.5, 0.5)), rotX(0.4));
  B.SC = 1.2;
  for (const s of [-1, 1]) {
    const f = rotY(-s * flap);
    B.add(mv(f, [0, 0.03, 0]), mv(f, [s * 0.2, 0.16, 0]), 0.075, 0.3);
    B.add([0, 0, 0], mv(f, [s * 0.24, 0.06, 0]), 0.07, 0.3);
    B.add(mv(f, [0, -0.03, 0]), mv(f, [s * 0.15, -0.13, 0]), 0.07, 0.3);
    B.add(mv(f, [0, -0.05, 0]), mv(f, [s * 0.08, -0.2, 0]), 0.05, 0.3);
    B.add([s * 0.01, 0.15, 0.02], [s * 0.06, 0.27, 0], 0.008, 1);
  }
  B.add([0, -0.13, 0.02], [0, 0.1, 0.02], 0.024, 1);
  B.ball([0, 0.13, 0.02], 0.032);
}

/** Octopus keys (u, x, y): one jet stroke per leg. */
const OKEY: V3[] = [[0, 0, -0.02], [0.25, -0.34, 0.1], [0.5, 0.08, 0.16], [0.75, 0.36, -0.08], [1, 0, -0.02]];

/** Position and the stroke phase within the current leg. */
function opath(u: number): V3 {
  let p: V3 = [OKEY[0]![1], OKEY[0]![2], 0];
  for (let i = 0; i < OKEY.length - 1; i++) {
    const a = OKEY[i]!;
    const b = OKEY[i + 1]!;
    if (u >= a[0]) {
      const f = clamp((u - a[0]) / (b[0] - a[0]), 0, 1);
      const e = 1 - (1 - f) ** 3;
      p = [mix(a[1], b[1], e), mix(a[2], b[2], e), f];
    }
  }
  return p;
}

function octoObj(B: Builder, u: number): void {
  const p = opath(u);
  const p1 = opath(Math.min(u + 0.03, 1));
  const p0 = opath(Math.max(u - 0.03, 0));
  const v: [number, number] = [p1[0] - p0[0], p1[1] - p0[1]];
  const squeeze = 1 - smoothstep(0, 0.25, p[2]);
  const spread = mix(0.8, 0.12, squeeze);
  B.C = [p[0], p[1], 0.28];
  B.M = rotZ(Math.atan2(-v[0], v[1]) * smoothstep(0.02, 0.08, Math.hypot(v[0], v[1])));
  B.ball([0, 0.16, -0.03], 0.13 * (1 - 0.12 * squeeze));
  B.ball([0, 0.05, 0], 0.1);
  B.ball([-0.05, 0.08, 0.085], 0.03);
  B.ball([0.05, 0.08, 0.085], 0.03);
  for (let i = 0; i < 8; i++) {
    const a = i * 0.78539816 + 0.39;
    const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
    let q0 = add3([0, -0.02, 0], scale3(dir, 0.06));
    for (let k = 0; k < 5; k++) {
      const reach = spread * (1 - 0.12 * k) * (1 + 0.4 * Math.sin(p[2] * 6.2832 - k * 0.9));
      const q = add3(q0, scale3(norm3(sub3(scale3(dir, reach), [0, 1, 0])), 0.065));
      B.add(q0, q, 0.028 - 0.0035 * k, 1);
      q0 = q;
    }
  }
}

/** Kepler orbit: the moon speeds up near the planet and passes behind it. */
function orbit(m: number, a: number, e: number): V3 {
  let E = m + e * Math.sin(m);
  E = m + e * Math.sin(E);
  return [a * (Math.cos(E) - e), 0, a * Math.sqrt(1 - e * e) * Math.sin(E)];
}

function planetObj(B: Builder, t: number): void {
  B.C = [0, -0.02, 0.25];
  B.M = mul(rotX(0.42), rotZ(0.28));
  B.ball([0, 0, 0], 0.17);
  let prev: V3 = [0.3, 0, 0];
  for (let i = 1; i <= 20; i++) {
    const a = i * 0.31415927;
    const q: V3 = [0.3 * Math.cos(a), 0, 0.3 * Math.sin(a)];
    B.add(prev, q, 0.045, 0.25);
    prev = q;
  }
  B.ball(orbit(t * 1.1, 0.42, 0.3), 0.05);
}

function buildObject(B: Builder, id: number, t: number, u: number, act: number): void {
  B.reset();
  if (id === 0) ringObj(B, u);
  else if (id === 1) skullObj(B, t, u, act);
  else if (id === 2) handObj(B, t, u);
  else if (id === 3) heartObj(B, t, act);
  else if (id === 4) helixObj(B, t, u);
  else if (id === 5) flyObj(B, t, u);
  else if (id === 6) octoObj(B, u);
  else planetObj(B, t);
}

/**
 * One solid per bin; its size and height follow that bin alone. Every solid
 * keeps its mean surface at the resting depth, so the eyes never refocus as
 * the tone moves: a bigger solid sits back by its extra bulge. u = 1 is balls
 * for the bars-into-balls shape.
 */
function spectrumObj(B: Builder, timing: StereoTiming, bins: number[], sfar: number, u: number): void {
  B.C = [0, 0, 0];
  B.M = I3;
  B.T = I3;
  B.SC = 1;
  const rack = timing.rack;
  const count = clamp(Math.floor(rack.solids + 0.5), 3, 6);
  const w = 0.5 * sfar * rack.width;
  const pitch = (2 * w + sfar * rack.gap) * timing.spacing;
  const grow = rack.growth;
  const rest = STEREO_Z_RANGE * rack.depth;
  const origin = rack.origin;
  for (let i = 0; i < count; i++) {
    const b = clamp(bins[i] ?? 0, 0, 1);
    const x = (i - 0.5 * (count - 1)) * pitch;
    const y0 = -0.36 + 0.1 * b;
    if (timing.shape === "oblong") {
      const h: V3 = [w, 0.04 + 0.28 * b, w];
      B.box([x, y0 + h[1], rest - boxBack(h)], h);
    } else if (timing.shape === "cubes") {
      const s0 = 0.9 * w;
      const s = s0 * (1 + 0.75 * grow * b);
      const h: V3 = [s, s, s];
      B.box([x + 2 * origin * (s - s0), -0.16 + 0.24 * b, rest - boxBack(h)], h);
    } else {
      // A round rod that shortens into the ball. A louder ball stretches right
      // into a pill: every row keeps its profile left of the moving end, so the
      // pattern there never slides and the form stays fused. Swelling widens the
      // whole dome instead, which slides the pattern under it.
      const k = timing.shape === "morph" ? u : 1;
      const swell = rack.ballGrow === "swell";
      const r = swell ? w * (1 + grow * b) : w;
      const rad = mix(w, r, k);
      const zr = rest - 0.785 * STEREO_RELIEF * w;
      const lo: V3 = [x, y0 + w, zr];
      const hi: V3 = [x, Math.max(y0 + w, y0 + 0.08 + 0.56 * b - w), zr];
      const ball: V3 = [x, -0.12, rest - 0.667 * STEREO_RELIEF * w];
      // The stretch leaves a third of a repeat before the neighbour.
      const reach = Math.min(2 * w * grow, Math.max(0, pitch - 2 * w - 0.35 * sfar));
      const end = add3(ball, [swell ? 0 : reach * b, 0, 0]);
      const off: V3 = [swell ? 2 * origin * (rad - w) : 0, 0, 0];
      B.add(add3(mix3(lo, ball, k), off), add3(mix3(hi, end, k), off), rad, mix(1, w / r, k));
    }
  }
}

/**
 * AI scene parts (recipe.ts): header (on, parts, turn angle, lift, centre xyz),
 * part A = (at relative to the centre, radius or box half-width), B = (capsule
 * end, or box half-height in x; code = shape + 4 react + 20 (bin + 1) + .9 amount).
 * Blocks keep the fixed three-quarter view as the scene turns.
 */
function aiObj(B: Builder, scene: StereoSceneFrame, lvl: number, bins: number[]): void {
  const h = scene.head;
  B.C = [h[4]!, h[5]! + h[3]!, h[6]!];
  B.M = I3;
  B.T = rotY(h[2]!);
  B.SC = 1;
  const n = Math.min(16, Math.floor(h[1]!));
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const P = scene.parts;
    const A: [number, number, number, number] = [P[o]!, P[o + 1]!, P[o + 2]!, P[o + 3]!];
    const Bv: [number, number, number, number] = [P[o + 4]!, P[o + 5]!, P[o + 6]!, P[o + 7]!];
    const m = Math.floor(Bv[3]);
    const kind = mod(m, 4);
    const react = mod(Math.floor(m / 4), 5);
    const bin = Math.trunc(m / 20) - 1;
    const v = fract(Bv[3]) / 0.9 * clamp(bin < 0 ? lvl : bins[bin] ?? 0, 0, 1);
    const grow = react === 1 ? 1 + 1.5 * v : 1;
    const shift: V3 = [0, react === 2 ? 0.3 * v : 0, react === 3 ? 0.3 * v : 0];
    const a = add3([A[0], A[1], A[2]], shift);
    if (kind === 2) {
      const hs = scale3([A[3], Bv[0], A[3]], grow);
      const w = add3(B.C, mv(B.T, a));
      // Stretch grows the block upward from its base.
      const up = react === 4 ? 3 * v * hs[1] : 0;
      B.box(add3(w, [0, up, 0]), add3(hs, [0, up, 0]));
      continue;
    }
    let b: V3 = kind === 1 ? add3([Bv[0], Bv[1], Bv[2]], shift) : [...a];
    if (react === 4) {
      if (kind === 1) b = add3(a, scale3(sub3(b, a), 1 + 3 * v));
      else { a[1] -= 0.15 * v; b = [b[0], b[1] + 0.15 * v, b[2]]; }
    }
    B.add(a, b, A[3] * grow, kind === 3 ? -1 : 1);
  }
}

/** Motion comes in bursts: still for `still` s, then `move` s eased in and out. */
export function burstTime(t: number, still: number, move: number): number {
  const k = Math.floor(t / (still + move));
  const a = clamp(t - k * (still + move) - still, 0, move);
  return k * move + a - move / (2 * Math.PI) * Math.sin(2 * Math.PI * a / move);
}

/**
 * Move a finished scene. Depth 40 and spacing 100 leave authored positions.
 * The rack applies both while it places solids; this covers the object cycle
 * and AI scenes. Blocks store half-size in B, so only their centre moves.
 */
function placeScene(parts: Part[], timing: StereoTiming): void {
  const k = timing.spacing;
  if (parts.length >= 2 && Math.abs(k - 1) > 1e-6) {
    let sx = 0;
    let n = 0;
    for (const p of parts) {
      if (p.g === STEREO_BLOCK) { sx += p.a[0]; n += 1; }
      else { sx += p.a[0] + p.b[0]; n += 2; }
    }
    const cx = sx / Math.max(1, n);
    for (const p of parts) {
      p.a[0] = cx + (p.a[0] - cx) * k;
      if (p.g !== STEREO_BLOCK) p.b[0] = cx + (p.b[0] - cx) * k;
    }
  }
  const zOff = (timing.rack.depth - STEREO_DEPTH.def / 100) * STEREO_Z_RANGE;
  if (Math.abs(zOff) < 1e-6) return;
  for (const p of parts) {
    p.a[2] += zOff;
    if (p.g !== STEREO_BLOCK) p.b[2] += zOff;
  }
}

/**
 * 1 just before and during each burst and while morphing, 0 once still: finer
 * texture hides the motion that would outline the object.
 */
export function fineGate(lt: number, hold: number, still: number, move: number): number {
  if (lt >= hold || still < 0.01) return 1;
  const tau = mod(lt, still + move);
  const lead = Math.min(1, 0.5 * still);
  return Math.max(smoothstep(still - lead, still, tau), 1 - smoothstep(0, lead, tau));
}

export interface StereoFrameInput {
  timing: StereoTiming;
  /** Host-integrated animation clock, seconds. */
  clock: number;
  /** LAN activity 0–1. */
  act: number;
  /** Audio level 0–1. */
  level: number;
  /** Eased spectrum bins, low frequency first. */
  bins: number[];
  /** AI scene this frame, or null. */
  ai: StereoSceneFrame | null;
}

/** Buffer slots 1–7 for this frame, 64 floats each. */
export function buildStereoFrame(input: StereoFrameInput): Float32Array {
  const { timing, clock: t, act, level } = input;
  const bins = Array.from({ length: STEREO_BINS }, (_, i) => input.bins[i] ?? 0);
  const { hold, morph, still } = timing;
  const move = Math.max(timing.move, 0.5);
  const sfar = 0.0104 * clamp(timing.repeat, 4, 16);
  const bands = Math.floor(clamp(timing.bands, 4, 40));
  const fineX = clamp(timing.motionBands, 1, 4);
  const n = Math.floor(t / (hold + morph));
  const lt = t - n * (hold + morph);
  const morphS = smoothstep(0, 1, clamp((lt - hold) / morph, 0, 1));
  const aiOn = !!input.ai && input.ai.head[0]! > 0.5 && input.ai.head[1]! > 0.5;

  const B = new Builder();
  let roomA = mod(n, 4);
  let roomB = mod(n + 1, 4);
  let roomMix = 0;
  if (aiOn) {
    roomA = roomB = 4;
    aiObj(B, input.ai!, timing.audio ? level : act, bins);
  } else if (timing.audio) {
    roomA = roomB = 0;
    // Bars on even object slots, balls on odd, easing across each morph.
    spectrumObj(B, timing, bins, sfar, mod(n, 2) < 0.5 ? morphS : 1 - morphS);
  } else {
    // Object clock: advances only in bursts and holds while morphing.
    const eh = burstTime(hold, still, move);
    const el = burstTime(Math.min(lt, hold), still, move);
    const te = n * eh + el;
    B.T = mul(rotY(0.35 * te), rotX(0.22 * Math.sin(0.23 * te)));
    if (lt < hold) {
      buildObject(B, mod(n, 8), te, el / Math.max(eh, 1e-3), act);
    } else {
      B.mixS = morphS;
      roomMix = morphS;
      B.mode = 1;
      buildObject(B, mod(n, 8), te, 1, act);
      B.beginMorph();
      buildObject(B, mod(n + 1, 8), te, 0, act);
      B.finishMorph();
    }
  }
  // The rack already placed depth and spacing with its solids.
  if (!(timing.audio && !aiOn)) placeScene(B.out, timing);

  let pn = n;
  let ps = morphS;
  if (timing.palette === "timer") {
    const pt = Math.max(timing.paletteSeconds, 2);
    pn = Math.floor(t / pt);
    ps = smoothstep(1 - Math.min(0.3, morph / pt), 1, fract(t / pt));
  }
  // The rack and AI scenes move all the time; a texture on the burst timer would crawl.
  const fine = fineX > 1 && !aiOn && !timing.audio ? fineGate(lt, hold, still, move) : 0;

  const out = new Float32Array(STEREO_FRAME_SLOTS * SLOT_FLOATS);
  B.out.forEach((p, i) => {
    out.set([p.a[0], p.a[1], p.a[2], p.r, p.b[0], p.b[1], p.b[2], p.g], i * 8);
  });
  out.set([
    B.out.length, roomA, roomB, roomMix,
    fine, mod(pn, 7), mod(pn + 1, 7), ps,
    sfar, bands, fineX, 0,
  ], HEAD);
  return out;
}
