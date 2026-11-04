/**
 * Marble Run sim: marbles follow the Blender-built track (track-data.ts) as a closed 1-D path.
 * Off the lift they roll under gravity (rolling sphere: 5/7 g along the slope) with rail friction
 * and drag; on the screw lift they ride at the lift speed. Neighbours on the path collide
 * elastically, and the lift admits one marble per thread pitch, so a busy run queues at the
 * bottom like a real one. No allocation per step.
 */

import { TRACK, TRACK_TAGS } from "./track-data";

export type TrackTag = (typeof TRACK_TAGS)[number];
export const TAG: Record<TrackTag, number> = Object.fromEntries(TRACK_TAGS.map((t, i) => [t, i])) as Record<TrackTag, number>;

export const SIM_DT = 1 / 60;
const SUBSTEP = 1 / 240;
const G = 9.81;
const ROLL = 5 / 7;
const MU = 0.02;
const DRAG = 0.6;
const V_MIN = 0.16;
const V_MAX = 3.2;
/** Gravity share and minimum speed on the loop: a real loop needs a taller drop than fits the board. */
const LOOP_G = 0.3;
const LOOP_VMIN = 0.95;
export const LIFT_PITCH = 0.48;

export type TrackData = {
  step: number;
  marbleRadius: number;
  points: number[];
  tags: number[];
  xylo: number[];
  bell: number;
};

export class TrackPath {
  readonly n: number;
  readonly step: number;
  readonly length: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly tag: Uint8Array;
  /** dy/ds at each sample (central difference). */
  readonly slope: Float32Array;
  /** Path distance of the lift's first and last sample. */
  readonly liftStart: number;
  readonly liftEnd: number;
  readonly xyloS: Float32Array;
  readonly bellS: number;

  constructor(data: TrackData = TRACK as TrackData) {
    const n = Math.floor(data.points.length / 3);
    if (n < 16 || data.tags.length !== n) throw new Error(`marble track: bad data (${n} points, ${data.tags.length} tags)`);
    this.n = n;
    this.step = data.step;
    this.length = n * data.step;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.tag = new Uint8Array(n); this.slope = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = data.points[i * 3]!; this.py[i] = data.points[i * 3 + 1]!; this.pz[i] = data.points[i * 3 + 2]!;
      this.tag[i] = data.tags[i]!;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      this.slope[i] = (this.py[b]! - this.py[a]!) / (2 * this.step);
    }
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) if (this.tag[i] === TAG.lift) { if (first < 0) first = i; last = i; }
    if (first < 0) throw new Error("marble track: no lift");
    this.liftStart = first * this.step;
    this.liftEnd = (last + 1) * this.step;
    this.xyloS = Float32Array.from(data.xylo.map((i) => i * this.step));
    this.bellS = data.bell * this.step;
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  index(s: number): number {
    return Math.floor(this.wrap(s) / this.step) % this.n;
  }

  tagAt(s: number): number { return this.tag[this.index(s)]!; }

  onLift(s: number): boolean {
    const w = this.wrap(s);
    return w >= this.liftStart && w < this.liftEnd;
  }

  slopeAt(s: number): number {
    const f = this.wrap(s) / this.step;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, u = f - Math.floor(f);
    return this.slope[i]! * (1 - u) + this.slope[j]! * u;
  }

  /** Position at path distance `s` into `out` (x, y, z). */
  sample(s: number, out: Float32Array | number[], o = 0): void {
    const f = this.wrap(s) / this.step;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, u = f - Math.floor(f);
    out[o] = this.px[i]! + (this.px[j]! - this.px[i]!) * u;
    out[o + 1] = this.py[i]! + (this.py[j]! - this.py[i]!) * u;
    out[o + 2] = this.pz[i]! + (this.pz[j]! - this.pz[i]!) * u;
  }
}

export type MarbleEvents = { bell: number; xylo: number[] };

export class MarbleSim {
  readonly track: TrackPath;
  readonly cap: number;
  count = 0;
  readonly s: Float64Array;
  readonly v: Float32Array;
  /** Colour hue 0..1, or -1 for clear (idle) glass. */
  readonly hue: Float32Array;
  readonly radius: Float32Array;
  liftSpeed = 0.55;
  time = 0;
  /** Strike counts since the last {@link takeEvents}. */
  bellHits = 0;
  readonly xyloHits: Uint16Array;
  private readonly order: Uint16Array;
  /** Called when marble `i` leaves the top of the lift so the pack can give it the next packet's colour. */
  recolor: ((i: number) => void) | null = null;

  constructor(cap = 48, track = new TrackPath()) {
    this.track = track;
    this.cap = cap;
    this.s = new Float64Array(cap); this.v = new Float32Array(cap);
    this.hue = new Float32Array(cap).fill(-1); this.radius = new Float32Array(cap).fill(0.018);
    this.order = new Uint16Array(cap);
    this.xyloHits = new Uint16Array(track.xyloS.length);
  }

  /** Grow or shrink the active population; new marbles enter in the lift queue. */
  setCount(n: number): void {
    const want = Math.max(0, Math.min(this.cap, Math.floor(n)));
    while (this.count < want) {
      const i = this.count++;
      // queue below the lift entry; contacts space them out on the first steps
      this.s[i] = this.track.wrap(this.track.liftStart - 0.04 * (1 + (i % 40)));
      this.v[i] = 0;
      this.hue[i] = -1;
      this.radius[i] = 0.018;
    }
    if (this.count > want) this.count = want;
  }

  private stepsLast = 0;

  /** Integrate steps the last {@link step} ran (bounded by the pack's maxSimStepsPerFrame). */
  integrateStepsLastFrame(): number { return this.stepsLast; }

  /** Advance by `dt` seconds in at most `maxSteps` equal substeps (≤ 1/240 s when the budget allows). */
  step(dt: number, maxSteps = 4): void {
    this.stepsLast = 0;
    if (!(dt > 0)) return;
    const t = Math.min(dt, 0.1);
    const n = Math.max(1, Math.min(Math.max(1, Math.floor(maxSteps)), Math.ceil(t / SUBSTEP - 1e-9)));
    const h = t / n;
    for (let k = 0; k < n; k++) this.substep(h);
    this.stepsLast = n;
  }

  private substep(h: number): void {
    const tr = this.track;
    const n = this.count;
    this.time += h;
    for (let i = 0; i < n; i++) {
      const s0 = this.s[i]!;
      if (tr.onLift(s0)) {
        this.v[i] = this.liftSpeed;
      } else {
        const tag = tr.tagAt(s0);
        const g = tag === TAG.loop ? LOOP_G : 1;
        let v = this.v[i]!;
        const a = -G * ROLL * g * tr.slopeAt(s0) - MU * G * Math.sign(v) - DRAG * v * Math.abs(v);
        v += a * h;
        const vmin = tag === TAG.loop ? LOOP_VMIN : V_MIN;
        this.v[i] = Math.max(vmin, Math.min(V_MAX, v));
      }
      // the lift admits a marble only a thread pitch behind the one ahead on it
      let ds = this.v[i]! * h;
      const before = tr.wrap(s0 - tr.liftStart);
      if (!tr.onLift(s0) && before > tr.length - 0.05 && !this.liftClear(i)) {
        ds = Math.min(ds, Math.max(0, tr.length - before - 0.001));
        if (ds <= 0) this.v[i] = 0;
      }
      const s1 = s0 + ds;
      this.crossings(s0, s1);
      if (tr.onLift(s0) && !tr.onLift(s1)) this.recolor?.(i);
      this.s[i] = tr.wrap(s1);
    }
    this.collide();
  }

  private liftClear(i: number): boolean {
    const tr = this.track;
    for (let k = 0; k < this.count; k++) {
      if (k === i) continue;
      const d = tr.wrap(this.s[k]! - tr.liftStart);
      if (d < LIFT_PITCH && tr.onLift(this.s[k]!)) return false;
    }
    return true;
  }

  private crossings(s0: number, s1: number): void {
    const tr = this.track;
    const a = tr.wrap(s0), d = s1 - s0;
    const hit = (x: number) => { const r = tr.wrap(x - a); return r > 0 && r <= d; };
    if (hit(tr.bellS)) this.bellHits++;
    for (let k = 0; k < tr.xyloS.length; k++) if (hit(tr.xyloS[k]!)) this.xyloHits[k]!++;
  }

  /** 1-D elastic contact between path neighbours (restitution 0.7). */
  private collide(): void {
    const n = this.count;
    if (n < 2) return;
    const tr = this.track;
    const ord = this.order;
    for (let i = 0; i < n; i++) ord[i] = i;
    const s = this.s;
    // insertion sort: the order barely changes between steps
    for (let i = 1; i < n; i++) {
      const x = ord[i]!; let j = i - 1;
      while (j >= 0 && s[ord[j]!]! > s[x]!) { ord[j + 1] = ord[j]!; j--; }
      ord[j + 1] = x;
    }
    for (let k = 0; k < n; k++) {
      const a = ord[k]!, b = ord[(k + 1) % n]!;
      const gap = tr.wrap(s[b]! - s[a]!);
      const min = this.radius[a]! + this.radius[b]!;
      if (gap >= min || gap > tr.length / 2) continue;
      if (tr.onLift(s[a]!) && tr.onLift(s[b]!)) continue;
      const va = this.v[a]!, vb = this.v[b]!;
      if (va > vb) {
        const e = 0.7, m = (va + vb) / 2, d = (va - vb) / 2;
        this.v[a] = m - e * d; this.v[b] = m + e * d;
      }
      s[a] = tr.wrap(s[b]! - min);
    }
  }

  /** The marble furthest along the visible run (for the follow camera). */
  leadIndex(): number {
    let best = -1, bestS = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.track.onLift(this.s[i]!)) continue;
      const d = this.track.wrap(this.s[i]! - this.track.liftEnd);
      if (d > bestS) { bestS = d; best = i; }
    }
    return best;
  }

  /** Deterministic digest for tests. */
  digest(): string {
    let h = 0;
    for (let i = 0; i < this.count; i++) h = (h * 31 + Math.round(this.s[i]! * 1000)) >>> 0;
    return h.toString(16);
  }
}
