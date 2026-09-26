/**
 * AI stereogram scenes: a few analytic parts the local model lays out, each
 * following one microphone bin (or the overall level) while audio reactive.
 * View-tangent units: x ±0.75 across, y −0.4 (bottom) to 0.38 (the fuse dots
 * sit at 0.43), z 0 (the back wall) to 0.5 (nearest the eye).
 */

import { STEREO_BINS } from "./drive";

export const STEREO_PARTS = 16;
export const STEREO_PART_FLOATS = STEREO_PARTS * 8;
/** Parts farther than this from the centre turn off the turntable; they would swing through the wall. */
export const STEREO_SPIN_REACH = 0.35;

export type StereoShape = "ball" | "capsule" | "box" | "dent";
export type StereoReact = "none" | "size" | "rise" | "forward" | "stretch";
type Vec3 = [number, number, number];

export interface StereoPart {
  shape: StereoShape;
  at: Vec3;
  /** Capsule far end; equals `at` for other shapes. */
  to: Vec3;
  /** Radius, or box half-width. */
  r: number;
  /** Box half-height; 0 for other shapes. */
  h: number;
  /** −1 overall level (LAN traffic while audio reactive is off), else a bin. */
  bin: number;
  react: StereoReact;
  amt: number;
}

export interface StereoRecipe {
  name: string;
  /** Turntable radians per animation second. */
  spin: number;
  bob: number;
  parts: StereoPart[];
}

const SHAPES: StereoShape[] = ["ball", "capsule", "box", "dent"];
const REACTS: StereoReact[] = ["none", "size", "rise", "forward", "stretch"];

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function vec(v: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(v) || v.length < 3) return [...fallback];
  return [num(v[0], -0.8, 0.8, fallback[0]), num(v[1], -0.45, 0.38, fallback[1]), num(v[2], 0, 0.55, fallback[2])];
}

function part(raw: unknown): StereoPart | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const shape = SHAPES.find((s) => s === String(o.shape ?? "").toLowerCase()) ?? null;
  if (!shape) return null;
  const at = vec(o.at, [0, 0, 0.3]);
  const react = REACTS.find((s) => s === String(o.react ?? "").toLowerCase()) ?? "none";
  const binRaw = Math.round(Number(o.bin));
  const bin = Number.isFinite(binRaw) ? Math.min(STEREO_BINS - 1, Math.max(-1, binRaw)) : -1;
  const amt = react === "none" ? 0 : num(o.amt, 0, 1, 0.5);
  if (shape === "box") {
    const size = Array.isArray(o.size) ? o.size : [];
    return {
      shape, at, to: [...at], bin, react, amt,
      r: num(size[0], 0.03, 0.6, 0.1) / 2,
      h: num(size[1], 0.03, 0.8, 0.1) / 2,
    };
  }
  return {
    shape, at, to: shape === "capsule" ? vec(o.to, at) : [...at], bin, react, amt,
    r: num(o.r, 0.012, 0.3, 0.08), h: 0,
  };
}

function centre(parts: StereoPart[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  if (!parts.length) return c;
  for (const p of parts) {
    for (let k = 0; k < 3; k++) c[k] += (p.at[k]! + p.to[k]!) / 2;
  }
  return [c[0] / parts.length, c[1] / parts.length, c[2] / parts.length];
}

function reach(parts: StereoPart[], c: Vec3): number {
  let far = 0;
  for (const p of parts) {
    for (const q of [p.at, p.to]) far = Math.max(far, Math.hypot(q[0] - c[0], q[2] - c[2]) + p.r);
  }
  return far;
}

/** A model reply (bare JSON, a fenced block, or an object). Null without one solid part. */
export function parseStereoRecipe(raw: unknown): StereoRecipe | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = (fence?.[1] ?? raw).trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const parts = (Array.isArray(o.parts) ? o.parts : []).map(part)
    .filter((p): p is StereoPart => !!p).slice(0, STEREO_PARTS);
  if (!parts.some((p) => p.shape !== "dent")) return null;
  const spin = num(o.spin, -1, 1, 0);
  return {
    name: String(o.name || "scene").slice(0, 40),
    spin: reach(parts, centre(parts)) > STEREO_SPIN_REACH ? 0 : spin,
    bob: num(o.bob, 0, 0.1, 0),
    parts,
  };
}

function mixV(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
}

function scaled(p: StereoPart, k: number): StereoPart {
  return { ...p, r: p.r * k, h: p.h * k };
}

/** Parts matched by index. Unlike shapes shrink away before the new one grows, as the shipped objects morph. */
export function blendStereoParts(from: StereoPart[], to: StereoPart[], s: number): StereoPart[] {
  const out: StereoPart[] = [];
  for (let i = 0; i < Math.max(from.length, to.length); i++) {
    const a = from[i];
    const b = to[i];
    if (!a) out.push(scaled(b!, s));
    else if (!b) out.push(scaled(a, 1 - s));
    else if (a.shape !== b.shape) out.push(s < 0.5 ? scaled(a, 1 - 2 * s) : scaled(b, 2 * s - 1));
    else {
      const late = s < 0.5 ? a : b;
      out.push({
        shape: b.shape, at: mixV(a.at, b.at, s), to: mixV(a.to, b.to, s),
        r: a.r + (b.r - a.r) * s, h: a.h + (b.h - a.h) * s,
        bin: late.bin, react: late.react, amt: a.amt + (b.amt - a.amt) * s,
      });
    }
  }
  return out.filter((p) => p.r > 1e-4).slice(0, STEREO_PARTS);
}

export interface StereoSceneFrame {
  /** Drive floats 24–31: on, parts, turn angle, lift, centre xyz, pad. */
  head: number[];
  /** `STEREO_PART_FLOATS` long; frame.ts turns them into world-space parts. */
  parts: number[];
}

/** Pack parts relative to their centre so the turntable spins the form in place. */
export function packStereoScene(parts: StereoPart[], angle: number, lift: number): StereoSceneFrame {
  const c = centre(parts);
  const out = new Array<number>(STEREO_PART_FLOATS).fill(0);
  parts.slice(0, STEREO_PARTS).forEach((p, i) => {
    const o = i * 8;
    const code = SHAPES.indexOf(p.shape) + 4 * REACTS.indexOf(p.react) + 20 * (p.bin + 1) + 0.9 * Math.min(1, Math.max(0, p.amt));
    out[o] = p.at[0] - c[0];
    out[o + 1] = p.at[1] - c[1];
    out[o + 2] = p.at[2] - c[2];
    out[o + 3] = p.r;
    if (p.shape === "box") out[o + 4] = p.h;
    else {
      out[o + 4] = p.to[0] - c[0];
      out[o + 5] = p.to[1] - c[1];
      out[o + 6] = p.to[2] - c[2];
    }
    out[o + 7] = code;
  });
  const n = Math.min(STEREO_PARTS, parts.length);
  return { head: [n > 0 ? 1 : 0, n, angle, lift, c[0], c[1], c[2], 0], parts: out };
}

function smooth(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t * t * (3 - 2 * t);
}

const TAU = Math.PI * 2;

/**
 * Plays recipes one after another. The morph runs on wall time so it finishes
 * in silence; turning and bobbing run on the animation clock, so they follow
 * the pace. A still scene eases back to face the eye.
 */
export class StereoScenePlayer {
  private from: StereoRecipe | null = null;
  private to: StereoRecipe | null = null;
  private startMs = 0;
  private clock0 = 0;
  private a0 = 0;
  private aim = 0;
  private morphMs = 3000;

  get current(): StereoRecipe | null { return this.to; }

  show(next: StereoRecipe, nowMs: number, clock: number, morphMs = 3000): void {
    const cur = this.state(nowMs, clock);
    this.from = cur ? { ...cur.recipe, parts: cur.parts } : null;
    this.a0 = cur ? Math.atan2(Math.sin(cur.angle), Math.cos(cur.angle)) : 0;
    this.aim = next.spin === 0 ? 0 : this.a0;
    this.to = next;
    this.startMs = nowMs;
    this.clock0 = clock;
    this.morphMs = Math.max(1, morphMs);
  }

  private state(nowMs: number, clock: number): { recipe: StereoRecipe; parts: StereoPart[]; angle: number; bob: number } | null {
    const to = this.to;
    if (!to) return null;
    const s = smooth((nowMs - this.startMs) / this.morphMs);
    const dc = clock - this.clock0;
    const fromSpin = this.from?.spin ?? 0;
    const angle = (this.a0 + fromSpin * dc) * (1 - s) + (this.aim + to.spin * dc) * s;
    const parts = this.from ? blendStereoParts(this.from.parts, to.parts, s) : blendStereoParts([], to.parts, s);
    const bob = (this.from?.bob ?? 0) * (1 - s) + to.bob * s;
    return { recipe: { ...to, spin: fromSpin * (1 - s) + to.spin * s }, parts, angle: angle % TAU, bob };
  }

  frame(nowMs: number, clock: number): StereoSceneFrame | null {
    const st = this.state(nowMs, clock);
    if (!st || !st.parts.length) return null;
    return packStereoScene(st.parts, st.angle, st.bob * Math.sin(1.3 * clock));
  }
}
