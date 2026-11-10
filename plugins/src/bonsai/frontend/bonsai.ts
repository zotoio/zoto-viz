/**
 * Bonsai pack: a slab-planted bonsai that answers the network. The host draws the Blender GLBs
 * (bench, board, slab, moss, trunk, foliage) and instances blossoms and falling leaves
 * (web/src/graph/bonsai-scenery.ts); this module runs the seasons and writes them into the viz slots.
 *
 * Slot 0 (BS_SLOT): header, camera, turntable yaw, light, fail and autumn state.
 * Slot 1: 16 pads x (presence, autumn): leaves whose rank is under presence show; autumn turns
 * them, leaf by leaf, to the autumn half of the atlas. Slots 2..3: 16 blossoms each as
 * x, y, z, look (look = tint + size / 2). Slot 4: 16 falling leaves as x, y, z, angle;
 * slot 5: the same leaves as tint, size, tumble axis, landed. Positions are board-local glTF
 * metres (the host turns them with the board).
 */

import type { VizDataFrame, VizPacketSample } from "../../../sdk/viz-contract";
import { BONSAI_DATA_MAPPING, ZOTO_FAIL_RGB, hash01, parseBonsaiOptions, type BonsaiOptions } from "./config";
import { BONSAI } from "./bonsai-data";
import { applyPackWorkBudget, bonsaiWorkBudget, parseBonsaiWorkBudgetYaml, resetPackWorkBudget } from "./work-budget";

export type { VizDataFrame, VizPacketSample };
export { BONSAI_DATA_MAPPING, ZOTO_FAIL_RGB, applyPackWorkBudget, bonsaiWorkBudget, parseBonsaiWorkBudgetYaml, resetPackWorkBudget };

export const BS_SLOT = {
  mark: 0,
  eyeX: 1, eyeY: 2, eyeZ: 3,
  aimX: 4, aimY: 5, aimZ: 6,
  fov: 7,
  yaw: 8, // turntable angle (rad) of the board, slab and tree
  failed: 9, // steady 0/1 after hysteresis: the sky chip
  autumn: 10, // 0..1 how far the season has turned (slow)
  warmth: 11, // 0 cool .. 1 low warm sun
  sunElev: 12, // sin of the sun's elevation, -1..1
  light: 13, // overall light level
  density: 14, // 0..1 leaf density from active talkers
  blossoms: 15,
  falling: 16,
  idle: 17,
  reduced: 18,
  lowFps: 19,
  audio: 20,
  talkers: 21,
  breeze: 22, // 0..1 sway amplitude for the host's leaf shader
  dayPhase: 23, // 0..1 of the day (0.5 = noon)
  failLevel: 24,
  night: 25, // 0..1
} as const;

export const BS_PAD_SLOT = 1;
export const BS_MAX_PADS = 16;
export const BS_BLOSSOM_SLOT0 = 2;
export const BS_BLOSSOM_SLOTS = 2;
export const BS_BLOSSOMS_PER_SLOT = 16;
export const BS_MAX_BLOSSOMS = BS_BLOSSOM_SLOTS * BS_BLOSSOMS_PER_SLOT;
export const BS_FALL_SLOT = 4;
export const BS_FALL_LOOK_SLOT = 5;
export const BS_MAX_FALLING = 16;
export const BS_SLOT_COUNT = 6;

/** Blossom tints the host knows: pink, blush, white, plum. */
export const BLOSSOM_TINTS = 4;
/** Falling-leaf tints the host knows: crimson, orange, gold. */
export const FALL_TINTS = 3;

const PADS = BONSAI.pads;
const N_PADS = Math.min(BS_MAX_PADS, PADS.length);
const GROW_S = 1.6;
const FADE_S = 3;
const AUTUMN_IN_S = 24;
const AUTUMN_OUT_S = 40;
const SHED_MAX = 0.55;
const LAND_S = 16;

export function encodeBlossomLook(tint: number, size: number): number {
  return Math.max(0, Math.min(BLOSSOM_TINTS - 1, Math.round(tint))) + Math.max(0, Math.min(0.999, size / 2));
}

export function decodeBlossomLook(look: number): { tint: number; size: number } {
  const k = Math.floor(look);
  return { tint: k, size: (look - k) * 2 };
}

export function blossomTintFor(pkt: Pick<VizPacketSample, "proto">): number {
  return Math.floor(hash01((pkt.proto || "ip").toLowerCase()) * BLOSSOM_TINTS) % BLOSSOM_TINTS;
}

/** Active talkers to leaf density: 30 % bare minimum, full at `full` talkers (log scale). */
export function densityFor(active: number, full: number, scale = 1): number {
  const n = Math.max(0, active);
  const d = 0.3 + 0.7 * Math.min(1, Math.log1p(n) / Math.log1p(Math.max(2, full)));
  return Math.max(0, Math.min(1, d * scale));
}

/** Light from the time of day (0..1, 0.5 = noon): sun height, warmth and level. */
export function lightFor(phase: number): { sunElev: number; warmth: number; light: number; night: number } {
  const sunElev = Math.sin((phase - 0.25) * Math.PI * 2);
  const warmth = sunElev > 0 ? Math.max(0, Math.min(1, 1.1 - sunElev * 1.3)) : Math.max(0, 0.45 + sunElev * 3);
  const light = sunElev > 0 ? 0.6 + 0.45 * Math.sqrt(sunElev) : Math.max(0.3, 0.6 + sunElev * 1.6);
  const night = Math.max(0, Math.min(1, -sunElev * 4));
  return { sunElev, warmth, light, night };
}

const FIXED_PHASE: Record<string, number> = { dawn: 0.29, day: 0.5, golden: 0.71, night: 0.92 };

export function dayPhaseFor(timeOfDay: string, now: Date): number {
  const fixed = FIXED_PHASE[timeOfDay];
  if (fixed !== undefined) return fixed;
  return (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600) / 24;
}

/** Board-local ground height (glTF y) under x, z: slab, moss and board, else the bench. */
export function groundAt(x: number, z: number): number {
  const g = BONSAI.ground;
  const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  if (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1) return BONSAI.board.bench;
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.nz - 2, Math.floor(fz));
  const u = fx - i, v = fz - j;
  const h = (ii: number, jj: number): number => g.h[jj * g.nx + ii]!;
  // the board edge is a step: never blend a board height with a bench height
  const c = [h(i, j), h(i + 1, j), h(i, j + 1), h(i + 1, j + 1)];
  const top = Math.max(...c);
  if (c.some((y) => top - y > 0.02)) return (u < 0.5 ? (v < 0.5 ? c[0] : c[2]) : (v < 0.5 ? c[1] : c[3]))!;
  return (c[0]! * (1 - u) + c[1]! * u) * (1 - v) + (c[2]! * (1 - u) + c[3]! * u) * v;
}

export function lowFpsFor(dtEma: number): boolean {
  return dtEma > 1 / 30;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeStep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Seeded order the pads turn in: outer, lower pads first, the apex last. */
const PAD_ORDER = (() => {
  const keys = Array.from({ length: N_PADS }, (_, k) => {
    const p = PADS[k]!;
    return { k, key: p.c[1] * 2 - Math.hypot(p.c[0], p.c[2]) + hash01(`pad${k}`) * 0.12 };
  });
  keys.sort((a, b) => a.key - b.key);
  const order = new Float32Array(N_PADS);
  keys.forEach((e, i) => { order[e.k] = N_PADS > 1 ? i / (N_PADS - 1) : 0; });
  return order;
})();
const PAD_BIAS = Float32Array.from({ length: N_PADS }, (_, k) => (hash01(`bias${k}`) - 0.5) * 0.12);

/** A point on the upper surface of pad k: `u`, `v` in 0..1. */
function padPoint(k: number, u: number, v: number, lift: number, out: Float32Array, o: number): void {
  const p = PADS[k]!;
  const az = u * Math.PI * 2;
  const el = (0.12 + 0.88 * v) * Math.PI * 0.42;
  out[o] = p.c[0] + Math.cos(az) * Math.cos(el) * p.r[0];
  out[o + 1] = p.c[1] + Math.sin(el) * p.r[1] * 1.25 + lift;
  out[o + 2] = p.c[2] + Math.sin(az) * Math.cos(el) * p.r[2];
}

let opts: BonsaiOptions = parseBonsaiOptions();
let clock: () => Date = () => new Date();
let simTime = 0;
let dtEma = 1 / 60;
let idleFlag = 0;
let hudSkipCount = 0;
let audioEma = 0;
let spawnSeq = 0;
let activeTalkers = 0;

const season = { density: 0.6, autumn: 0, phase: 0.5, warmth: 0.5, light: 0.8, sunElev: 0.5, night: 0, yaw: 0.6, breeze: 0.3 };
const fail = { ema: 0, on: false };
const rate = { short: 0, long: 0, cooldown: 2, demoT: 4 };
const pads = { presence: new Float32Array(BS_MAX_PADS), autumn: new Float32Array(BS_MAX_PADS), shed: new Float32Array(BS_MAX_PADS), tokens: new Float32Array(BS_MAX_PADS) };
const bl = {
  age: new Float32Array(BS_MAX_BLOSSOMS),
  life: new Float32Array(BS_MAX_BLOSSOMS),
  size: new Float32Array(BS_MAX_BLOSSOMS),
  tint: new Uint8Array(BS_MAX_BLOSSOMS),
  pos: new Float32Array(BS_MAX_BLOSSOMS * 3),
  live: new Uint8Array(BS_MAX_BLOSSOMS),
};
const fl = {
  live: new Uint8Array(BS_MAX_FALLING),
  pos: new Float32Array(BS_MAX_FALLING * 3),
  origin: new Float32Array(BS_MAX_FALLING * 2),
  vy: new Float32Array(BS_MAX_FALLING),
  sway: new Float32Array(BS_MAX_FALLING),
  freq: new Float32Array(BS_MAX_FALLING),
  phase: new Float32Array(BS_MAX_FALLING),
  angle: new Float32Array(BS_MAX_FALLING),
  spin: new Float32Array(BS_MAX_FALLING),
  axis: new Float32Array(BS_MAX_FALLING),
  tint: new Uint8Array(BS_MAX_FALLING),
  size: new Float32Array(BS_MAX_FALLING),
  landed: new Float32Array(BS_MAX_FALLING),
  t: new Float32Array(BS_MAX_FALLING),
  fallSince: 0,
};
const cam = { eye: new Float32Array(3), aim: new Float32Array(3), fov: BONSAI.camera.fovDeg as number, init: false, t: 0 };
const want = new Float32Array(7);
const slots: Float32Array[] = Array.from({ length: BS_SLOT_COUNT }, () => new Float32Array(64));

export function bonsaiOptions(): BonsaiOptions { return opts; }
export function bonsaiHudSkipCount(): number { return hudSkipCount; }
export function bonsaiFailed(): boolean { return fail.on; }
export function bonsaiSeason(): Readonly<typeof season> { return season; }
export function bonsaiPads(): { presence: Float32Array; autumn: Float32Array; shed: Float32Array } { return pads; }
export function bonsaiBlossomCount(): number { let n = 0; for (let i = 0; i < BS_MAX_BLOSSOMS; i++) n += bl.live[i]!; return n; }
export function bonsaiFallingCount(): number { let n = 0; for (let i = 0; i < BS_MAX_FALLING; i++) n += fl.live[i]!; return n; }
export function bonsaiPadCount(): number { return N_PADS; }

/** Tests pin the clock; the view reads local time. */
export function setBonsaiClock(fn: () => Date): void { clock = fn; }

export function setBonsaiOptions(next: BonsaiOptions): void {
  opts = next;
}

export function disposeBonsaiPack(): void {
  opts = parseBonsaiOptions();
  clock = () => new Date();
  simTime = 0; dtEma = 1 / 60; idleFlag = 0; hudSkipCount = 0; audioEma = 0; spawnSeq = 0; activeTalkers = 0;
  Object.assign(season, { density: 0.6, autumn: 0, phase: 0.5, warmth: 0.5, light: 0.8, sunElev: 0.5, night: 0, yaw: 0.6, breeze: 0.3 });
  fail.ema = 0; fail.on = false;
  Object.assign(rate, { short: 0, long: 0, cooldown: 2, demoT: 4 });
  pads.presence.fill(0); pads.autumn.fill(0); pads.shed.fill(0); pads.tokens.fill(0);
  bl.live.fill(0);
  fl.live.fill(0); fl.fallSince = 0;
  cam.init = false; cam.t = 0;
  seasonInit = false;
}

let seasonInit = false;

function reducedOn(): boolean {
  return opts.reducedMotion === "on";
}

/** Failed state: slow EMA plus hysteresis, so a flapping unit never flickers the season. */
function stepFail(frame: VizDataFrame, dt: number): void {
  const raw = Math.max(0, Math.min(1, frame.sys?.failed ?? 0));
  fail.ema += (raw - fail.ema) * (1 - Math.exp(-dt / 1.5));
  if (!fail.on && fail.ema >= opts.failThreshold) fail.on = true;
  else if (fail.on && fail.ema < opts.failThreshold * 0.7) fail.on = false;
}

function countActive(frame: VizDataFrame): number {
  const list = frame.talkers ?? [];
  if (!list.length) {
    // demo garden: 3..10 talkers breathing over three minutes
    return Math.round(6.5 + 3.5 * Math.sin(simTime * (Math.PI * 2) / 180));
  }
  let n = 0;
  for (const t of list) if (t && Number.isFinite(t.rate) && t.rate > 0.05) n++;
  return n;
}

function stepSeason(frame: VizDataFrame, dt: number): void {
  activeTalkers = countActive(frame);
  const target = densityFor(activeTalkers, opts.densityTalkers, opts.leafDensity);
  const lt = lightFor(dayPhaseFor(opts.timeOfDay, clock()));
  if (!seasonInit) {
    season.density = target;
    Object.assign(season, lt);
    seasonInit = true;
  }
  season.density += (target - season.density) * (1 - Math.exp(-dt / 6));
  const k = 1 - Math.exp(-dt / 3);
  season.sunElev += (lt.sunElev - season.sunElev) * k;
  season.warmth += (lt.warmth - season.warmth) * k;
  season.light += (lt.light - season.light) * k;
  season.night += (lt.night - season.night) * k;
  season.phase = dayPhaseFor(opts.timeOfDay, clock());
  season.autumn = fail.on
    ? Math.min(1, season.autumn + dt / AUTUMN_IN_S)
    : Math.max(0, season.autumn - dt / AUTUMN_OUT_S);
  if (opts.turnMinutes > 0 && !reducedOn()) {
    season.yaw = (season.yaw + (dt * Math.PI * 2) / (opts.turnMinutes * 60)) % (Math.PI * 2);
  }
  const audio = Math.max(0, Math.min(1, frame.audio || 0));
  audioEma += (audio - audioEma) * (1 - Math.exp(-dt * 1.5));
  const want = Math.min(1, opts.breeze * (0.65 + 0.35 * audioEma) + 0.15 * Math.min(1, rate.short / 40));
  season.breeze += (want * (reducedOn() ? 0.4 : 1) - season.breeze) * (1 - Math.exp(-dt / 2));
  for (let p = 0; p < N_PADS; p++) {
    const a = Math.max(0, Math.min(1, (season.autumn - PAD_ORDER[p]! * 0.55) / 0.45));
    pads.autumn[p] = a;
    if (a > 0.6) pads.shed[p] = Math.min(SHED_MAX, pads.shed[p]! + dt / 80);
    else pads.shed[p] = Math.max(0, pads.shed[p]! - dt / 70);
    pads.presence[p] = Math.max(0, Math.min(1, season.density + PAD_BIAS[p]!)) * (1 - pads.shed[p]!);
  }
}

function spawnBlossoms(tint: number): void {
  const cap = Math.min(BS_MAX_BLOSSOMS, opts.blossoms ? opts.blossomCap : 0);
  if (cap <= 0) return;
  const r = rng(0x5eed + spawnSeq++ * 7919);
  // the fullest pads carry the flowers
  let best = 0, bestScore = -1;
  for (let p = 0; p < N_PADS; p++) {
    const s = pads.presence[p]! * (1 - pads.autumn[p]!) * (0.5 + r());
    if (s > bestScore) { bestScore = s; best = p; }
  }
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    let slot = -1;
    for (let j = 0; j < cap; j++) if (!bl.live[j]) { slot = j; break; }
    if (slot < 0) {
      // the oldest bloom gives way, already fading
      let oldest = -1, age = -1;
      for (let j = 0; j < cap; j++) if (bl.age[j]! > age) { age = bl.age[j]!; oldest = j; }
      if (oldest < 0) return;
      slot = oldest;
    }
    bl.live[slot] = 1;
    bl.age[slot] = -i * 0.35;
    bl.life[slot] = 14 + r() * 8;
    bl.size[slot] = 0.75 + r() * 0.45;
    bl.tint[slot] = tint;
    padPoint(best, r(), r(), 0.004, bl.pos, slot * 3);
  }
}

function stepBlossoms(frame: VizDataFrame, dt: number): void {
  const pkts = frame.packets ?? [];
  const take = Math.min(pkts.length, bonsaiWorkBudget().maxPacketsPerFrame);
  if (pkts.length > take) hudSkipCount += pkts.length - take;
  const inst = pkts.length / Math.max(1 / 240, dt);
  rate.short += (inst - rate.short) * (1 - Math.exp(-dt / 0.6));
  rate.long += (inst - rate.long) * (1 - Math.exp(-dt / 30));
  rate.cooldown = Math.max(0, rate.cooldown - dt);
  const burst = rate.short > Math.max(4, rate.long * 2.0);
  let fire = burst && rate.cooldown <= 0;
  let tint = take ? blossomTintFor(pkts[0]!) : 0;
  if (frame.demo && !pkts.length) {
    rate.demoT -= dt;
    if (rate.demoT <= 0) {
      rate.demoT = 9 + hash01(`demo${spawnSeq}`) * 6;
      fire = rate.cooldown <= 0;
      tint = spawnSeq % BLOSSOM_TINTS;
    }
  }
  if (fire && !fail.on) {
    spawnBlossoms(tint);
    rate.cooldown = reducedOn() ? 6 : 3;
  }
  const cap = Math.min(BS_MAX_BLOSSOMS, opts.blossoms ? opts.blossomCap : 0);
  for (let j = 0; j < BS_MAX_BLOSSOMS; j++) {
    if (!bl.live[j]) continue;
    if (j >= cap) { bl.live[j] = 0; continue; }
    // autumn closes the flowers sooner
    bl.age[j] = bl.age[j]! + dt * (1 + 2 * season.autumn);
    if (bl.age[j]! > bl.life[j]! + FADE_S) bl.live[j] = 0;
  }
}

function blossomScale(j: number): number {
  const a = bl.age[j]!;
  if (a <= 0) return 0;
  const grow = easeStep(a / GROW_S);
  const fade = a > bl.life[j]! ? 1 - easeStep((a - bl.life[j]!) / FADE_S) : 1;
  return bl.size[j]! * grow * fade;
}

function spawnFalling(p: number): boolean {
  const cap = Math.min(BS_MAX_FALLING, opts.fallCap);
  let slot = -1;
  for (let j = 0; j < cap; j++) if (!fl.live[j]) { slot = j; break; }
  if (slot < 0) {
    // a resting leaf makes room first
    let best = -1, t = -1;
    for (let j = 0; j < cap; j++) if (fl.landed[j]! > 0 && fl.t[j]! > t) { t = fl.t[j]!; best = j; }
    if (best < 0) return false;
    slot = best;
  }
  const r = rng(0xfa11 + spawnSeq++ * 104729);
  fl.live[slot] = 1;
  padPoint(p, r(), 0.15 + r() * 0.6, -0.004, fl.pos, slot * 3);
  fl.origin[slot * 2] = fl.pos[slot * 3]!;
  fl.origin[slot * 2 + 1] = fl.pos[slot * 3 + 2]!;
  fl.vy[slot] = 0.03 + r() * 0.025;
  fl.sway[slot] = 0.012 + r() * 0.012;
  fl.freq[slot] = 0.3 + r() * 0.25;
  fl.phase[slot] = r() * Math.PI * 2;
  fl.angle[slot] = r() * Math.PI * 2;
  fl.spin[slot] = (r() - 0.5) * 1.4;
  fl.axis[slot] = r() * Math.PI * 2;
  fl.tint[slot] = Math.floor(r() * FALL_TINTS);
  fl.size[slot] = 0.85 + r() * 0.25;
  fl.landed[slot] = 0;
  fl.t[slot] = 0;
  return true;
}

function stepFalling(dt: number): void {
  const rateK = reducedOn() ? 0.5 : 1;
  fl.fallSince += dt;
  for (let p = 0; p < N_PADS; p++) {
    if (pads.autumn[p]! > 0.6 && pads.shed[p]! < SHED_MAX) pads.tokens[p] = Math.min(2, pads.tokens[p]! + dt * 0.12 * rateK);
    else pads.tokens[p] = Math.max(0, pads.tokens[p]! - dt * 0.2);
  }
  // one leaf at a time, never a shower: at most one every 0.8 s across the tree
  if (fl.fallSince > 0.8 / rateK) {
    let best = -1, tok = 1;
    for (let p = 0; p < N_PADS; p++) if (pads.tokens[p]! >= tok) { tok = pads.tokens[p]!; best = p; }
    if (best >= 0 && spawnFalling(best)) {
      pads.tokens[best] = pads.tokens[best]! - 1;
      fl.fallSince = 0;
    }
  }
  const cap = Math.min(BS_MAX_FALLING, opts.fallCap);
  const slow = reducedOn() ? 0.7 : 1;
  for (let j = 0; j < BS_MAX_FALLING; j++) {
    if (!fl.live[j]) continue;
    if (j >= cap) { fl.live[j] = 0; continue; }
    fl.t[j] = fl.t[j]! + dt;
    if (fl.landed[j]! > 0) {
      fl.landed[j] = fl.landed[j]! + dt;
      // healthy again: fallen leaves clear sooner
      if (fl.landed[j]! > LAND_S * (fail.on ? 1 : 0.5) + 2.5) fl.live[j] = 0;
      continue;
    }
    const o = j * 3;
    const t = fl.t[j]!;
    fl.pos[o + 1] = fl.pos[o + 1]! - fl.vy[j]! * dt * slow;
    const w = Math.sin(t * fl.freq[j]! * Math.PI * 2 + fl.phase[j]!);
    fl.pos[o] = fl.origin[j * 2]! + fl.sway[j]! * w + 0.004 * t;
    fl.pos[o + 2] = fl.origin[j * 2 + 1]! + fl.sway[j]! * 0.6 * Math.cos(t * fl.freq[j]! * Math.PI * 2 + fl.phase[j]!);
    fl.angle[j] = fl.angle[j]! + fl.spin[j]! * dt * slow;
    const floor = groundAt(fl.pos[o]!, fl.pos[o + 2]!) + 0.003;
    if (fl.pos[o + 1]! <= floor) {
      fl.pos[o + 1] = floor;
      fl.landed[j] = 1e-3;
    }
  }
}

function landedScale(j: number): number {
  const l = fl.landed[j]!;
  if (l <= 0) return fl.size[j]!;
  const stay = LAND_S * (fail.on ? 1 : 0.5);
  return fl.size[j]! * (l > stay ? 1 - easeStep((l - stay) / 2.5) : 1);
}

const CAMERAS = {
  garden: { ty: 0.27, dist: 1.5, el: 12, fov: 30, amp: 0.06 },
  close: { ty: 0.3, dist: 1.0, el: 10, fov: 30, amp: 0.04 },
  low: { ty: 0.27, dist: 1.4, el: 5, fov: 30, amp: 0.05 },
  gallery: { ty: 0.25, dist: 1.85, el: 20, fov: 28, amp: 0.04 },
} as const;

function stepCamera(dt: number): void {
  const c = CAMERAS[opts.cameraMode];
  const reduced = reducedOn();
  cam.t += dt;
  const yaw = reduced ? 0 : c.amp * Math.sin((cam.t * Math.PI * 2) / 120);
  const er = (c.el * Math.PI) / 180;
  want[0] = c.dist * Math.sin(yaw) * Math.cos(er);
  want[1] = c.ty + c.dist * Math.sin(er);
  want[2] = c.dist * Math.cos(yaw) * Math.cos(er);
  want[3] = 0; want[4] = c.ty; want[5] = 0; want[6] = c.fov;
  if (!cam.init) {
    cam.eye.set(want.subarray(0, 3)); cam.aim.set(want.subarray(3, 6)); cam.fov = want[6]!;
    cam.init = true;
    return;
  }
  const k = 1 - Math.exp(-dt * (reduced ? 0.6 : 1.2));
  for (let i = 0; i < 3; i++) {
    cam.eye[i] = cam.eye[i]! + (want[i]! - cam.eye[i]!) * k;
    cam.aim[i] = cam.aim[i]! + (want[3 + i]! - cam.aim[i]!) * k;
  }
  cam.fov += (want[6]! - cam.fov) * k;
}

/** Advance the garden by one host frame. */
export function ingestFrame(frame: VizDataFrame): void {
  const dt = frame.dt > 0 ? Math.min(frame.dt, 0.1) : 1 / 60;
  const steps = Math.max(1, Math.min(bonsaiWorkBudget().maxSimStepsPerFrame || 1, Math.ceil(dt / (1 / 30))));
  const h = dt / steps;
  idleFlag = frame.demo ? 1 : 0;
  dtEma += ((frame.dt > 0 ? frame.dt : 1 / 60) - dtEma) * 0.1;
  for (let i = 0; i < steps; i++) {
    simTime += h;
    stepFail(frame, h);
    stepSeason(frame, h);
    stepFalling(h);
  }
  stepBlossoms(frame, dt);
  stepCamera(dt);
}

/** Fill the slot buffers (reused every frame). */
export function packBonsaiSlots(frame: VizDataFrame): Float32Array[] {
  const hd = slots[0]!;
  hd.fill(0);
  hd[BS_SLOT.mark] = 1;
  hd[BS_SLOT.eyeX] = cam.eye[0]!; hd[BS_SLOT.eyeY] = cam.eye[1]!; hd[BS_SLOT.eyeZ] = cam.eye[2]!;
  hd[BS_SLOT.aimX] = cam.aim[0]!; hd[BS_SLOT.aimY] = cam.aim[1]!; hd[BS_SLOT.aimZ] = cam.aim[2]!;
  hd[BS_SLOT.fov] = cam.fov;
  hd[BS_SLOT.yaw] = season.yaw;
  hd[BS_SLOT.failed] = fail.on ? 1 : 0;
  hd[BS_SLOT.autumn] = season.autumn;
  hd[BS_SLOT.warmth] = season.warmth;
  hd[BS_SLOT.sunElev] = season.sunElev;
  hd[BS_SLOT.light] = season.light;
  hd[BS_SLOT.density] = season.density;
  hd[BS_SLOT.idle] = idleFlag;
  hd[BS_SLOT.reduced] = reducedOn() ? 1 : 0;
  hd[BS_SLOT.lowFps] = lowFpsFor(dtEma) ? 1 : 0;
  hd[BS_SLOT.audio] = Math.max(0, Math.min(1, frame.audio || 0));
  hd[BS_SLOT.talkers] = activeTalkers;
  hd[BS_SLOT.breeze] = season.breeze;
  hd[BS_SLOT.dayPhase] = season.phase;
  hd[BS_SLOT.failLevel] = fail.ema;
  hd[BS_SLOT.night] = season.night;
  const ps = slots[BS_PAD_SLOT]!;
  ps.fill(0);
  for (let p = 0; p < N_PADS; p++) {
    ps[p * 2] = pads.presence[p]!;
    ps[p * 2 + 1] = pads.autumn[p]!;
  }
  for (let m = 0; m < BS_BLOSSOM_SLOTS; m++) slots[BS_BLOSSOM_SLOT0 + m]!.fill(0);
  let n = 0;
  for (let j = 0; j < BS_MAX_BLOSSOMS; j++) {
    if (!bl.live[j]) continue;
    const s = blossomScale(j);
    if (s <= 0.002) continue;
    const buf = slots[BS_BLOSSOM_SLOT0 + Math.floor(n / BS_BLOSSOMS_PER_SLOT)]!;
    const o = (n % BS_BLOSSOMS_PER_SLOT) * 4;
    buf[o] = bl.pos[j * 3]!; buf[o + 1] = bl.pos[j * 3 + 1]!; buf[o + 2] = bl.pos[j * 3 + 2]!;
    buf[o + 3] = encodeBlossomLook(bl.tint[j]!, s);
    n++;
  }
  hd[BS_SLOT.blossoms] = n;
  const fp = slots[BS_FALL_SLOT]!, fk = slots[BS_FALL_LOOK_SLOT]!;
  fp.fill(0); fk.fill(0);
  let f = 0;
  for (let j = 0; j < BS_MAX_FALLING; j++) {
    if (!fl.live[j]) continue;
    const s = landedScale(j);
    if (s <= 0.002) continue;
    const o = f * 4;
    fp[o] = fl.pos[j * 3]!; fp[o + 1] = fl.pos[j * 3 + 1]!; fp[o + 2] = fl.pos[j * 3 + 2]!;
    fp[o + 3] = fl.angle[j]!;
    fk[o] = fl.tint[j]!; fk[o + 1] = s; fk[o + 2] = fl.axis[j]!; fk[o + 3] = fl.landed[j]! > 0 ? 1 : 0;
    f++;
  }
  hd[BS_SLOT.falling] = f;
  return slots;
}
