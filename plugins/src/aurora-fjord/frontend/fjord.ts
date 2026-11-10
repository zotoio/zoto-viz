/**
 * Aurora Fjord pack: a night fjord under the aurora. The host draws the Blender terrain and shore
 * GLBs, mirrors them in the water, lights the cabin windows and instances ripples
 * (web/src/graph/aurora-fjord-scenery.ts); the sky shader draws the aurora, stars, open water
 * and fog. This module turns the planetary K-index, talkers, packets and sys.failed into the
 * viz slots both of them read.
 *
 * Slot 0 (AF_SLOT): header, camera, aurora (Kp, strength, speed, latitude, storm, phase), fog,
 * fail state, haze and aurora colours, the Kp history. Slot 1: 8 cabins x 8 floats (AF_CABIN).
 * Slot 2: 16 ripples as x, z, radius, look where look = round(hue * 255) + intensity (0..0.999).
 */

import type { VizDataFrame, VizHeadline, VizPacketSample, VizTalkerSample } from "../../../sdk/viz-contract";
import {
  assignTalkerSlots,
  createTalkerSlotArrays,
  createTalkerSlotScratch,
  resizeTalkerSlotArrays,
  type SlotTalker,
  type TalkerSlot,
} from "../../../sdk/talker-slots";
import { FJORD_DATA_MAPPING, ZOTO_FAIL_RGB, hash01, parseFjordOptions, type FjordOptions } from "./config";
import { FJORD } from "./fjord-data";
import { applyPackWorkBudget, fjordWorkBudget, parseFjordWorkBudgetYaml, resetPackWorkBudget } from "./work-budget";

export type { VizDataFrame, VizPacketSample };
export { FJORD_DATA_MAPPING, ZOTO_FAIL_RGB, applyPackWorkBudget, fjordWorkBudget, parseFjordWorkBudgetYaml, resetPackWorkBudget };

export const AF_SLOT = {
  mark: 0,
  eyeX: 1, eyeY: 2, eyeZ: 3,
  aimX: 4, aimY: 5, aimZ: 6,
  fov: 7,
  kp: 8,
  strength: 9,
  speed: 10,
  latitude: 11,
  storm: 12,
  fog: 13,
  failed: 14, // steady 0/1 after hysteresis: the fail chip and the fog bank
  kpLive: 15, // 1 while Kp comes from the bound source, 0 on the demo curve
  audio: 16,
  idle: 17,
  reduced: 18,
  lowFps: 19,
  cabins: 20,
  ripples: 21,
  moon: 22,
  kpMax: 23,
  fogFront: 24,
  calm: 25,
  phase: 26,
  gauge: 27,
  hazeR: 28,
  auroraR: 31,
  time: 34,
  failLevel: 35,
  trend: 36,
  history: 40, // 8 Kp readings, oldest first
} as const;

export const AF_CABIN_SLOT = 1;
export const AF_CABIN_FLOATS = 8;
export const AF_MAX_CABINS = 8;
export const AF_CABIN = { light: 0, flash: 1, warmth: 2, present: 3, shoreX: 4, shoreZ: 5 } as const;
export const AF_RIPPLE_SLOT = 2;
export const AF_MAX_RIPPLES = 16;
export const KP_HISTORY = 8;

/** Phase and time wrap here so float32 slots keep millisecond precision (one seam every few hours). */
const WRAP = 8192;
const KP_EASE_S = 8;
const KP_STALE_S = 20;
const RIPPLE_LIFE_S = 4;
const RIPPLES_PER_S = 5;
const FOG_EASE_S = 6;
const FRONT_FAR = -1350;
const FRONT_NEAR = -200;

const KP_TEXT = /^\s*Kp\s+(\d+(?:\.\d+)?)/i;
const KP_PEAK = /24\s*h\s+max\s+(\d+(?:\.\d+)?)/i;

export interface KpReading {
  kp: number;
  max24: number;
  /** Newest first. */
  history: number[];
}

/** Index of a source headline id `<source>:<i>` (newest first on the wire), or a large number. */
function headlineIndex(id: string): number {
  const m = /:(\d+)$/.exec(id);
  return m ? Number(m[1]) : 1e9;
}

/**
 * Kp from the bound source's headlines (`Kp 3.00 · unsettled`, newest first). Prefers rows of
 * `source`; any `Kp <value>` headline counts when the source has another id.
 */
export function parseKpHeadlines(headlines: readonly VizHeadline[] | undefined, source = "noaa-kp"): KpReading | null {
  if (!headlines?.length) return null;
  const rows: { i: number; kp: number; summary?: string }[] = [];
  const pick = (own: boolean) => {
    for (const h of headlines) {
      if (!h || typeof h.text !== "string") continue;
      if (own && !(source && typeof h.id === "string" && h.id.startsWith(`${source}:`))) continue;
      const m = KP_TEXT.exec(h.text);
      if (!m) continue;
      const kp = Number(m[1]);
      if (!Number.isFinite(kp) || kp < 0 || kp > 9.5) continue;
      rows.push({ i: headlineIndex(String(h.id ?? "")), kp: Math.min(9, kp), summary: h.summary });
    }
  };
  pick(true);
  if (!rows.length) pick(false);
  if (!rows.length) return null;
  rows.sort((a, b) => a.i - b.i);
  const history = rows.slice(0, KP_HISTORY).map((r) => r.kp);
  const peak = rows[0]!.summary ? KP_PEAK.exec(rows[0]!.summary) : null;
  const max24 = peak ? Math.min(9, Number(peak[1])) : Math.max(...history);
  return { kp: rows[0]!.kp, max24: Number.isFinite(max24) ? max24 : rows[0]!.kp, history };
}

/** Golden idle mock: a slow deterministic Kp walk from quiet to a substorm and back (~5 min). */
export function demoKp(t: number): number {
  const v = 2.6 + 2.3 * Math.sin((t * Math.PI * 2) / 300) + 0.9 * Math.sin((t * Math.PI * 2) / 71 + 1.1)
    + 0.45 * Math.sin((t * Math.PI * 2) / 23 + 0.4);
  return Math.max(0.3, Math.min(8.3, v));
}

/** Aurora from Kp: strength 0..1, curtain speed (phase units/s), latitude 0 (north horizon)..1 (overhead), storm fringe. */
export function auroraFromKp(kp: number, gain = 1, speedScale = 1): { strength: number; speed: number; latitude: number; storm: number } {
  const k = Math.max(0, Math.min(9, Number.isFinite(kp) ? kp : 0));
  const n = Math.max(0, Math.min(1, (k - 0.3) / 6));
  const strength = Math.min(1, (0.08 + 0.92 * Math.pow(n, 0.8)) * gain);
  const speed = (0.2 + 0.16 * k) * speedScale;
  const latitude = Math.min(1, k / 8);
  const s = Math.max(0, Math.min(1, (k - 4.5) / 3));
  return { strength, speed, latitude, storm: s * s * (3 - 2 * s) };
}

/** Window warmth 0 (amber) .. 1 (pale): self is the warmest, the gateway the palest. */
export function windowWarmth(t: Pick<VizTalkerSample, "id" | "role">): number {
  const role = (t.role || "").toLowerCase();
  if (role === "self") return 0.05;
  if (role === "gateway") return 0.85;
  return 0.2 + 0.5 * hash01(t.id);
}

export function windowLevel(rate: number): number {
  return 0.3 + 0.7 * Math.min(1, Math.log1p(Math.max(0, rate)) / Math.log1p(400));
}

export function rippleHue(pkt: Pick<VizPacketSample, "proto">): number {
  const h = hash01(pkt.proto || "ip");
  return h < 0.5 ? 0.07 + 0.08 * h : 0.34 + 0.1 * (h - 0.5);
}

export function encodeRippleLook(hue: number, intensity: number): number {
  return Math.round(Math.max(0, Math.min(1, hue)) * 255) + Math.max(0, Math.min(0.999, intensity));
}

export function decodeRippleLook(look: number): { hue: number; intensity: number } {
  const k = Math.floor(look);
  return { hue: k / 255, intensity: look - k };
}

export function lowFpsFor(dtEma: number): boolean {
  return dtEma > 1 / 30;
}

interface Cabin {
  shown: string | null;
  fade: number;
  rateEma: number;
  warmth: number;
  flash: number;
  acc: number;
}

const newCabin = (): Cabin => ({ shown: null, fade: 0, rateEma: 0, warmth: 0.3, flash: 0, acc: 0 });

let opts: FjordOptions = parseFjordOptions();
const cabins: Cabin[] = Array.from({ length: AF_MAX_CABINS }, newCabin);
let slotPair: [TalkerSlot[], TalkerSlot[]] = createTalkerSlotArrays(opts.cabinCap);
const scratch = createTalkerSlotScratch();
const byId = new Map<string, SlotTalker>();
const rateCache = new Map<string, { rate: number }>();
const seen = new Map<string, VizTalkerSample>();
let simTime = 0;
let dtEma = 1 / 60;
let idleFlag = 0;
let hudSkipCount = 0;
let audioEma = 0;

const kp = { value: 0, target: 0, init: false, live: false, lastLiveAt: -1e9, max24: 0, trend: 0, history: new Float32Array(KP_HISTORY) };
const aurora = { strength: 0, speed: 0, latitude: 0, storm: 0, phase: 0 };
const fail = { ema: 0, on: false };
const fog = { level: 0, front: FRONT_FAR };
let calm = 1;
let rippleRate = 0;
let rippleSerial = 0;

const rp = {
  active: new Uint8Array(AF_MAX_RIPPLES),
  x: new Float32Array(AF_MAX_RIPPLES),
  z: new Float32Array(AF_MAX_RIPPLES),
  age: new Float32Array(AF_MAX_RIPPLES),
  maxR: new Float32Array(AF_MAX_RIPPLES),
  hue: new Float32Array(AF_MAX_RIPPLES),
  gain: new Float32Array(AF_MAX_RIPPLES),
  tokens: 0,
  count: 0,
};

const cam = { eye: new Float32Array(3), aim: new Float32Array(3), fov: FJORD.camera.fovDeg as number, init: false, t: 0 };
const want = new Float32Array(7);
const slots: Float32Array[] = Array.from({ length: 3 }, () => new Float32Array(64));

const DEMO_TALKERS: VizTalkerSample[] = [
  { id: "demo-self", rate: 120, role: "self" },
  { id: "demo-gateway", rate: 60, role: "gateway" },
  { id: "demo-nas", rate: 25, role: "lan" },
  { id: "demo-cloud", rate: 9, role: "internet" },
  { id: "demo-printer", rate: 2, role: "lan" },
];

export function fjordOptions(): FjordOptions { return opts; }
export function fjordHudSkipCount(): number { return hudSkipCount; }
export function fjordFailed(): boolean { return fail.on; }
export function fjordCabins(): readonly Readonly<Cabin>[] { return cabins; }
export function fjordRippleCount(): number { return rp.count; }
export function fjordKp(): { value: number; live: boolean; max24: number } { return { value: kp.value, live: kp.live, max24: kp.max24 }; }
export function fjordAurora(): Readonly<typeof aurora> { return aurora; }
export function fjordFog(): Readonly<typeof fog> { return fog; }

export function setFjordOptions(next: FjordOptions): void {
  opts = next;
  if (slotPair[0].length !== opts.cabinCap) slotPair = resizeTalkerSlotArrays(slotPair, opts.cabinCap);
}

export function disposeFjordPack(): void {
  opts = parseFjordOptions();
  slotPair = createTalkerSlotArrays(opts.cabinCap);
  for (let k = 0; k < AF_MAX_CABINS; k++) cabins[k] = newCabin();
  byId.clear(); rateCache.clear(); seen.clear();
  simTime = 0; dtEma = 1 / 60; idleFlag = 0; hudSkipCount = 0; audioEma = 0;
  Object.assign(kp, { value: 0, target: 0, init: false, live: false, lastLiveAt: -1e9, max24: 0, trend: 0 });
  kp.history.fill(0);
  Object.assign(aurora, { strength: 0, speed: 0, latitude: 0, storm: 0, phase: 0 });
  fail.ema = 0; fail.on = false;
  fog.level = 0; fog.front = FRONT_FAR;
  calm = 1; rippleRate = 0; rippleSerial = 0;
  rp.active.fill(0); rp.tokens = 0; rp.count = 0;
  cam.init = false; cam.t = 0;
}

function reducedOn(): boolean {
  return opts.reducedMotion === "on";
}

function stepKp(frame: VizDataFrame, dt: number): void {
  const reading = opts.kpMode === "live" ? parseKpHeadlines(frame.headlines, opts.source) : null;
  if (reading) {
    kp.target = reading.kp;
    kp.max24 = reading.max24;
    kp.lastLiveAt = simTime;
    kp.live = true;
    // history slots are oldest first; a short history keeps its oldest value in the empty slots
    const h = reading.history;
    for (let i = 0; i < KP_HISTORY; i++) kp.history[KP_HISTORY - 1 - i] = h[Math.min(i, h.length - 1)]!;
    kp.trend = h.length > 1 ? h[0]! - h[1]! : 0;
  } else if (!kp.live || simTime - kp.lastLiveAt > KP_STALE_S) {
    // no source (or it went away): the golden idle mock, sampled every 20 s for the gauge
    kp.live = false;
    kp.target = demoKp(simTime);
    let peak = 0;
    for (let i = 0; i < KP_HISTORY; i++) {
      const v = demoKp(simTime - (KP_HISTORY - 1 - i) * 20);
      kp.history[i] = v;
      peak = Math.max(peak, v);
    }
    kp.max24 = peak;
    kp.trend = kp.history[KP_HISTORY - 1]! - kp.history[KP_HISTORY - 2]!;
  }
  if (!kp.init) {
    kp.value = kp.target;
    kp.init = true;
  } else {
    kp.value += (kp.target - kp.value) * (1 - Math.exp(-dt / KP_EASE_S));
  }
  const a = auroraFromKp(kp.value, opts.auroraGain, opts.auroraSpeed * (reducedOn() ? 0.5 : 1));
  aurora.strength = a.strength;
  aurora.speed = a.speed;
  aurora.latitude = a.latitude;
  aurora.storm = a.storm;
  aurora.phase = (aurora.phase + a.speed * dt) % WRAP;
}

/** Failed state: slow EMA plus hysteresis, so a flapping unit never makes the chip blink. */
function stepFail(frame: VizDataFrame, dt: number): void {
  const raw = Math.max(0, Math.min(1, frame.sys?.failed ?? 0));
  fail.ema += (raw - fail.ema) * (1 - Math.exp(-dt / 1.5));
  if (!fail.on && fail.ema >= opts.failThreshold) fail.on = true;
  else if (fail.on && fail.ema < opts.failThreshold * 0.7) fail.on = false;
  const target = fail.on
    ? opts.fogDensity * (0.7 + 0.3 * Math.min(1, fail.ema / Math.min(1, opts.failThreshold * 2)))
    : opts.hazeFloor;
  fog.level += (target - fog.level) * (1 - Math.exp(-dt / (FOG_EASE_S * (reducedOn() ? 1.5 : 1))));
  // the bank's front rolls from the fjord head toward the camera as it thickens
  const f = Math.max(0, Math.min(1, fog.level / 0.8));
  fog.front = FRONT_FAR + (FRONT_NEAR - FRONT_FAR) * f * f * (3 - 2 * f);
}

function stepTalkers(frame: VizDataFrame, dt: number): void {
  const list = frame.talkers?.length ? frame.talkers : DEMO_TALKERS;
  if (!frame.talkers?.length) {
    for (let i = 0; i < DEMO_TALKERS.length; i++) {
      const base = [120, 60, 25, 9, 2][i]!;
      DEMO_TALKERS[i]!.rate = base * (0.7 + 0.3 * Math.sin(simTime * 0.05 + i * 1.7));
    }
  }
  byId.clear();
  seen.clear();
  for (const t of list) {
    if (!t || typeof t.id !== "string" || !t.id) continue;
    let r = rateCache.get(t.id);
    if (!r) {
      r = { rate: 0 };
      rateCache.set(t.id, r);
    }
    r.rate = Number.isFinite(t.rate) ? Math.max(0, t.rate) : 0;
    byId.set(t.id, r);
    seen.set(t.id, t);
  }
  if (rateCache.size > 256) {
    for (const id of rateCache.keys()) if (!byId.has(id)) rateCache.delete(id);
  }
  const [prev, out] = slotPair;
  assignTalkerSlots(byId, prev, out, scratch, simTime);
  slotPair = [out, prev];
  const cur = slotPair[0];
  const slow = reducedOn() ? 0.5 : 1;
  for (let k = 0; k < AF_MAX_CABINS; k++) {
    const c = cabins[k]!;
    const target = k < cur.length && k < opts.cabinCap ? cur[k]!.id : null;
    if (c.shown !== target) {
      // a new occupant: the old light goes out first, then the new one comes on
      c.fade = Math.max(0, c.fade - (dt / 1.2) * slow);
      if (c.fade <= 0) {
        c.shown = target;
        c.flash = 0;
        const t = target ? seen.get(target) : undefined;
        c.rateEma = t ? Math.max(0, t.rate) : 0;
        c.warmth = t ? windowWarmth(t) : 0.3;
      }
    } else if (target) {
      c.fade = Math.min(1, c.fade + (dt / 1.5) * slow);
    }
    const t = c.shown ? seen.get(c.shown) : undefined;
    const rate = t && Number.isFinite(t.rate) ? Math.max(0, t.rate) : 0;
    c.rateEma += (rate - c.rateEma) * (1 - Math.exp(-dt / 1.5));
    c.flash *= Math.exp(-dt * 2.2);
  }
}

function cabinLight(k: number): number {
  const c = cabins[k]!;
  return k < opts.cabinCap && c.shown ? c.fade * windowLevel(c.rateEma) : 0;
}

/** Smooth weighted round robin over the lit cabins (busier cabins send more ripples). */
function pickCabin(): number {
  let total = 0;
  for (let k = 0; k < opts.cabinCap; k++) {
    const c = cabins[k]!;
    const w = c.shown && c.fade > 0.5 ? 0.2 + Math.log1p(c.rateEma) : 0;
    c.acc += w;
    total += w;
  }
  if (total <= 0) return -1;
  let best = -1, bestAcc = -Infinity;
  for (let k = 0; k < opts.cabinCap; k++) {
    const c = cabins[k]!;
    if (c.shown && c.fade > 0.5 && c.acc > bestAcc) { bestAcc = c.acc; best = k; }
  }
  if (best >= 0) cabins[best]!.acc -= total;
  return best;
}

function spawnRipple(slot: number, pkt: VizPacketSample): void {
  const k = pickCabin();
  const h1 = hash01(`r${rippleSerial}a`), h2 = hash01(`r${rippleSerial}b`);
  rippleSerial = (rippleSerial + 1) % 100000;
  if (k >= 0) {
    const [sx, , sz] = FJORD.cabins[k]!.shore;
    const out = sx > 0 ? -1 : 1;
    rp.x[slot] = sx + out * (8 + 34 * h1);
    rp.z[slot] = sz + (h2 - 0.5) * 30;
    cabins[k]!.flash = Math.min(1, cabins[k]!.flash + 0.5);
    rp.gain[slot] = 0.45 + 0.55 * cabinLight(k);
  } else {
    // nobody home: the ripple rises mid-fjord, dimmer
    rp.x[slot] = (h1 - 0.5) * 160;
    rp.z[slot] = -160 - 260 * h2;
    rp.gain[slot] = 0.4;
  }
  rp.age[slot] = 0;
  const field = Number.isFinite(pkt.field) ? Math.max(0, Math.min(1, pkt.field)) : 0.3;
  rp.maxR[slot] = 9 + 12 * field;
  rp.hue[slot] = rippleHue(pkt);
  rp.active[slot] = 1;
}

function stepRipples(frame: VizDataFrame, dt: number): void {
  const cap = Math.min(AF_MAX_RIPPLES, opts.ripples ? opts.rippleCap : 0);
  const pkts = frame.packets ?? [];
  const take = Math.min(pkts.length, fjordWorkBudget().maxPacketsPerFrame);
  if (pkts.length > take) hudSkipCount += pkts.length - take;
  const rate = RIPPLES_PER_S * (reducedOn() ? 0.5 : 1);
  rp.tokens = Math.min(3, rp.tokens + dt * rate);
  let spawned = 0;
  for (let i = 0; i < take && rp.tokens >= 1; i++) {
    let slot = -1;
    for (let j = 0; j < cap; j++) if (!rp.active[j]) { slot = j; break; }
    if (slot < 0) break;
    rp.tokens -= 1;
    spawnRipple(slot, pkts[i]!);
    spawned++;
  }
  rippleRate += (spawned / Math.max(dt, 1e-3) - rippleRate) * (1 - Math.exp(-dt / 3));
  let live = 0;
  for (let j = 0; j < AF_MAX_RIPPLES; j++) {
    if (!rp.active[j]) continue;
    if (j >= cap) { rp.active[j] = 0; continue; }
    rp.age[j] = rp.age[j]! + dt;
    if (rp.age[j]! >= RIPPLE_LIFE_S) { rp.active[j] = 0; continue; }
    live++;
  }
  rp.count = live;
  calm = Math.max(0.3, Math.min(1, 1 - 0.5 * Math.min(1, rippleRate / RIPPLES_PER_S) + opts.calmBias));
}

function stepCamera(dt: number): void {
  const reduced = reducedOn();
  cam.t += dt;
  let ex: number = FJORD.camera.eye[0], ey: number = FJORD.camera.eye[1], ez: number = FJORD.camera.eye[2];
  let ax: number = FJORD.camera.aim[0], ay: number = FJORD.camera.aim[1];
  const az: number = FJORD.camera.aim[2];
  let fov: number = FJORD.camera.fovDeg, amp = 0;
  switch (opts.cameraMode) {
    case "fixed": break;
    case "low": ex = 6; ey = 5; ez = 30; ay = 72; amp = 0.02; break;
    case "high": ex = 10; ey = 46; ez = 60; ay = 64; fov = 36; amp = 0.025; break;
    default: amp = 0.03;
  }
  let yaw = 0, bob = 0;
  if (!reduced) {
    yaw = amp * Math.sin((cam.t * Math.PI * 2) / 150);
    bob = amp * 30 * Math.sin((cam.t * Math.PI * 2) / 97 + 0.7);
  }
  const dx = ax - ex, dz = az - ez;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  ax = ex + dx * c - dz * s;
  const azr = ez + dx * s + dz * c;
  want[0] = ex; want[1] = ey + bob; want[2] = ez;
  want[3] = ax; want[4] = ay; want[5] = azr; want[6] = fov;
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

/** Advance the fjord by one host frame. */
export function ingestFrame(frame: VizDataFrame): void {
  const dt = frame.dt > 0 ? Math.min(frame.dt, 0.1) : 1 / 60;
  const steps = Math.max(1, Math.min(fjordWorkBudget().maxSimStepsPerFrame || 1, Math.ceil(dt / (1 / 30))));
  const h = dt / steps;
  idleFlag = frame.demo ? 1 : 0;
  dtEma += ((frame.dt > 0 ? frame.dt : 1 / 60) - dtEma) * 0.1;
  for (let i = 0; i < steps; i++) {
    simTime += h;
    stepFail(frame, h);
    stepTalkers(frame, h);
  }
  stepKp(frame, dt);
  stepRipples(frame, dt);
  stepCamera(dt);
  const audio = Math.max(0, Math.min(1, frame.audio || 0));
  audioEma += (audio - audioEma) * (1 - Math.exp(-dt * 2));
}

/** Haze colour shared by the sky and the scenery's fog patch: night blue, aurora-tinted, greyer in fog. */
function haze(out: Float32Array, o: number, moon: number, aur: readonly number[]): void {
  const f = Math.min(1, fog.level);
  for (let c = 0; c < 3; c++) {
    const base = [0.03, 0.042, 0.066][c]! + moon * [0.018, 0.024, 0.034][c]! + aur[c]! * 0.05 * aurora.strength * (1 - f);
    const grey = [0.1, 0.112, 0.13][c]! * (0.6 + 0.6 * moon);
    out[o + c] = base + (grey - base) * f * 0.8;
  }
}

/** Fill the slot buffers (reused every frame). */
export function packFjordSlots(frame: VizDataFrame): Float32Array[] {
  const hd = slots[0]!;
  hd.fill(0);
  hd[AF_SLOT.mark] = 1;
  hd[AF_SLOT.eyeX] = cam.eye[0]!; hd[AF_SLOT.eyeY] = cam.eye[1]!; hd[AF_SLOT.eyeZ] = cam.eye[2]!;
  hd[AF_SLOT.aimX] = cam.aim[0]!; hd[AF_SLOT.aimY] = cam.aim[1]!; hd[AF_SLOT.aimZ] = cam.aim[2]!;
  hd[AF_SLOT.fov] = cam.fov;
  hd[AF_SLOT.kp] = kp.value;
  hd[AF_SLOT.strength] = aurora.strength;
  hd[AF_SLOT.speed] = aurora.speed;
  hd[AF_SLOT.latitude] = aurora.latitude;
  hd[AF_SLOT.storm] = aurora.storm;
  hd[AF_SLOT.fog] = fog.level;
  hd[AF_SLOT.failed] = fail.on ? 1 : 0;
  hd[AF_SLOT.kpLive] = kp.live ? 1 : 0;
  hd[AF_SLOT.audio] = audioEma;
  hd[AF_SLOT.idle] = idleFlag;
  hd[AF_SLOT.reduced] = reducedOn() ? 1 : 0;
  hd[AF_SLOT.lowFps] = lowFpsFor(dtEma) ? 1 : 0;
  hd[AF_SLOT.kpMax] = kp.max24;
  hd[AF_SLOT.fogFront] = fog.front;
  hd[AF_SLOT.calm] = calm;
  hd[AF_SLOT.phase] = aurora.phase;
  hd[AF_SLOT.gauge] = opts.gauge ? 1 : 0;
  const moon = opts.moon * (1 - 0.4 * Math.min(1, fog.level));
  hd[AF_SLOT.moon] = moon;
  // aurora green, a touch more teal while quiet
  const s = aurora.strength;
  const aur = [0.22 + 0.08 * s, 0.85 + 0.15 * s, 0.6 - 0.1 * s];
  hd[AF_SLOT.auroraR] = aur[0]!; hd[AF_SLOT.auroraR + 1] = aur[1]!; hd[AF_SLOT.auroraR + 2] = aur[2]!;
  haze(hd, AF_SLOT.hazeR, moon, aur);
  hd[AF_SLOT.time] = simTime % WRAP;
  hd[AF_SLOT.failLevel] = fail.ema;
  hd[AF_SLOT.trend] = kp.trend;
  hd.set(kp.history, AF_SLOT.history);

  const cb = slots[AF_CABIN_SLOT]!;
  cb.fill(0);
  let lit = 0;
  for (let k = 0; k < AF_MAX_CABINS; k++) {
    const c = cabins[k]!;
    const o = k * AF_CABIN_FLOATS;
    const geo = FJORD.cabins[k]!;
    const light = cabinLight(k);
    cb[o + AF_CABIN.light] = light;
    cb[o + AF_CABIN.flash] = c.flash;
    cb[o + AF_CABIN.warmth] = c.warmth;
    cb[o + AF_CABIN.present] = k < opts.cabinCap ? 1 : 0;
    cb[o + AF_CABIN.shoreX] = geo.shore[0];
    cb[o + AF_CABIN.shoreZ] = geo.shore[2];
    if (light > 0.03) lit++;
  }
  hd[AF_SLOT.cabins] = lit;

  const rb = slots[AF_RIPPLE_SLOT]!;
  rb.fill(0);
  let n = 0;
  for (let j = 0; j < AF_MAX_RIPPLES; j++) {
    if (!rp.active[j]) continue;
    const u = rp.age[j]! / RIPPLE_LIFE_S;
    const o = n * 4;
    rb[o] = rp.x[j]!;
    rb[o + 1] = rp.z[j]!;
    rb[o + 2] = rp.maxR[j]! * (1 - (1 - u) * (1 - u));
    const inten = Math.min(1, u / 0.08) * Math.pow(1 - u, 1.5) * rp.gain[j]!;
    rb[o + 3] = encodeRippleLook(rp.hue[j]!, 0.02 + 0.97 * inten);
    n++;
  }
  hd[AF_SLOT.ripples] = n;
  return slots;
}
