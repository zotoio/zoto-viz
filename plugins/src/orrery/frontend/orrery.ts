/**
 * Orrery pack: talkers are planets on the arms of a brass clockwork orrery. The host draws the
 * Blender GLBs (desk, machine, planet templates) and instances arms, planets and sparks
 * (web/src/graph/orrery-scenery.ts); this module runs the escapement, the orbits, the sparks and
 * the camera, and writes them into the viz slots.
 *
 * Slot 0 (OR_SLOT): header, camera, escapement angles, sun/lamp levels, fail state.
 * Slot 1: 8 arms x 8 floats (OR_ARM). Slots 2..3: 16 sparks each as x, y, z, look where
 * look = round(hue * 255) + intensity (0..0.999).
 */

import type { VizDataFrame, VizPacketSample, VizTalkerSample } from "../../../sdk/viz-contract";
import {
  assignTalkerSlots,
  createTalkerSlotArrays,
  createTalkerSlotScratch,
  resizeTalkerSlotArrays,
  type SlotTalker,
  type TalkerSlot,
} from "../../../sdk/talker-slots";
import { ORRERY_DATA_MAPPING, ZOTO_FAIL_RGB, hash01, parseOrreryOptions, type OrreryOptions } from "./config";
import { ORRERY } from "./orrery-data";
import { applyPackWorkBudget, orreryWorkBudget, parseOrreryWorkBudgetYaml, resetPackWorkBudget } from "./work-budget";

export type { VizDataFrame, VizPacketSample };
export { ORRERY_DATA_MAPPING, ZOTO_FAIL_RGB, applyPackWorkBudget, orreryWorkBudget, parseOrreryWorkBudgetYaml, resetPackWorkBudget };

export const OR_SLOT = {
  mark: 0,
  eyeX: 1, eyeY: 2, eyeZ: 3,
  aimX: 4, aimY: 5, aimZ: 6,
  fov: 7,
  arms: 8,
  failed: 9, // steady 0/1 after hysteresis: the sky plaque and the slowed escapement
  escape: 10,
  anchor: 11,
  balance: 12,
  gearCrown: 13,
  gear2: 14,
  gear3: 15,
  sun: 16,
  audio: 17,
  idle: 18,
  sparks: 19,
  tick: 20, // 1 on a beat, decays: the lamp/sky never flash on it, the escape wheel just steps
  reduced: 21,
  lowFps: 22,
  lamp: 23,
  failLevel: 24,
} as const;

export const OR_ARM_SLOT = 1;
export const OR_ARM_FLOATS = 8;
export const OR_MAX_ARMS = 8;
export const OR_ARM = { angle: 0, radius: 1, hub: 2, type: 3, size: 4, spin: 5, present: 6, flash: 7 } as const;
export const OR_SPARK_SLOT0 = 2;
export const OR_SPARK_SLOTS = 2;
export const OR_SPARKS_PER_SLOT = 16;
export const OR_MAX_SPARKS = OR_SPARK_SLOTS * OR_SPARKS_PER_SLOT;

/** Planet maps in orrery-planets.glb: planet-0..6. */
export const PLANET_NAMES = ["jove", "terra", "ares", "luna", "nox", "glacier", "saturn"] as const;
const OTHER_PLANETS = [1, 2, 3, 4, 5] as const;

export const BEAT_S = 0.5;
const ESC_STEP = Math.PI / 15; // half a tooth of the 15-tooth escape wheel per beat
const STEP_FRAC = 0.18; // the wheel moves in the first 18 % of a beat, then rests on the pallet
const ANCHOR_AMP = 0.12;
const BALANCE_AMP = 2.4;
const FAIL_BALANCE = 0.55;
const FAIL_DRIVE = 0.4;
const PLANET_R_MIN = 0.02;
const PLANET_R_SPAN = 0.018;
const SPARK_SPEED = 0.45;
const FAIL_HUE = 0.004;

export function planetTypeFor(t: Pick<VizTalkerSample, "id" | "role">): number {
  const role = (t.role || "").toLowerCase();
  if (role === "gateway") return 6;
  if (role === "self") return 0;
  return OTHER_PLANETS[Math.floor(hash01(t.id) * OTHER_PLANETS.length) % OTHER_PLANETS.length]!;
}

/** Orbit speed (rad/s): log of rate, Kepler-ish falloff with arm radius. */
export function orbitOmega(rate: number, armRadius: number, orbitSpeed = 1): number {
  const n = Math.min(1, Math.log1p(Math.max(0, rate)) / Math.log1p(400));
  return (0.03 + 0.42 * n) * Math.sqrt(ORRERY.arms[0]!.radius / armRadius) * orbitSpeed;
}

/** Planet radius (m) from estimated bytes/s over the slow window. */
export function planetRadius(bytesPerSec: number, scale = 1): number {
  const n = Math.min(1, Math.max(0, Math.log10(1 + Math.max(0, bytesPerSec)) / 6));
  return (PLANET_R_MIN + PLANET_R_SPAN * n) * scale;
}

export function sparkHue(pkt: VizPacketSample): number {
  // amber to pale gold: sparks stay in the brass family, protocol only shifts the tint
  return 0.06 + hash01(pkt.proto || "ip") * 0.09;
}

export function encodeSparkLook(hue: number, intensity: number): number {
  return Math.round(Math.max(0, Math.min(1, hue)) * 255) + Math.max(0, Math.min(0.999, intensity));
}

export function decodeSparkLook(look: number): { hue: number; intensity: number } {
  const k = Math.floor(look);
  return { hue: k / 255, intensity: look - k };
}

/** Uneven beat while failed: 2.2-3.1x longer, fixed per beat index so it never jitters per frame. */
export function beatLength(index: number, failed: boolean, tickRate: number): number {
  const base = BEAT_S / Math.max(0.25, tickRate);
  if (!failed) return base;
  return base * (2.2 + 0.9 * hash01(`beat${index}`));
}

const easeStep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function lowFpsFor(dtEma: number): boolean {
  return dtEma > 1 / 30;
}

interface Arm {
  shown: string | null;
  present: number;
  angle: number;
  spin: number;
  rate: number;
  rateEma: number;
  vol: number;
  type: number;
  flash: number;
  acc: number;
}

const newArm = (k: number): Arm => ({
  shown: null, present: 0, angle: (k * 2.399) % (Math.PI * 2), spin: k * 0.7, rate: 0, rateEma: 0, vol: 0, type: -1, flash: 0, acc: 0,
});

let opts: OrreryOptions = parseOrreryOptions();
const arms: Arm[] = Array.from({ length: OR_MAX_ARMS }, (_, k) => newArm(k));
let slotPair: [TalkerSlot[], TalkerSlot[]] = createTalkerSlotArrays(opts.planetCap);
const scratch = createTalkerSlotScratch();
const byId = new Map<string, SlotTalker>();
const rateCache = new Map<string, { rate: number }>();
const seen = new Map<string, VizTalkerSample>();
let simTime = 0;
let sizeEma = 600;
let dtEma = 1 / 60;

const esc = { base: 0, phase: 0, index: 0, len: BEAT_S, tick: 0, angle: 0, anchor: -ANCHOR_AMP, balance: 0, amp: BALANCE_AMP };
const fail = { ema: 0, on: false };
let sunGlow = 0.8;
let audioEma = 0;
let idleFlag = 0;
let hudSkipCount = 0;

const sp = {
  active: new Uint8Array(OR_MAX_SPARKS),
  s: new Float32Array(OR_MAX_SPARKS),
  arm: new Int8Array(OR_MAX_SPARKS),
  hue: new Float32Array(OR_MAX_SPARKS),
  pos: new Float32Array(OR_MAX_SPARKS * 3),
  look: new Float32Array(OR_MAX_SPARKS),
  tokens: 0,
  count: 0,
};
const path = new Float32Array(8 * 3);
const segLen = new Float32Array(7);
let pathN = 0;

const cam = { eye: new Float32Array(3), aim: new Float32Array(3), fov: ORRERY.camera.fovDeg as number, init: false, t: 0 };
const want = new Float32Array(7);
const slots: Float32Array[] = Array.from({ length: 2 + OR_SPARK_SLOTS }, () => new Float32Array(64));

const DEMO_TALKERS: VizTalkerSample[] = [
  { id: "demo-self", rate: 120, role: "self" },
  { id: "demo-gateway", rate: 60, role: "gateway" },
  { id: "demo-nas", rate: 25, role: "lan" },
  { id: "demo-cloud", rate: 9, role: "internet" },
  { id: "demo-printer", rate: 2, role: "lan" },
];

export function orreryOptions(): OrreryOptions { return opts; }
export function orreryHudSkipCount(): number { return hudSkipCount; }
export function orreryFailed(): boolean { return fail.on; }
export function orreryArms(): readonly Readonly<Arm>[] { return arms; }
export function orrerySparkCount(): number { return sp.count; }
export function orreryEscapement(): Readonly<typeof esc> { return esc; }

export function setOrreryOptions(next: OrreryOptions): void {
  opts = next;
  if (slotPair[0].length !== opts.planetCap) slotPair = resizeTalkerSlotArrays(slotPair, opts.planetCap);
}

export function disposeOrreryPack(): void {
  opts = parseOrreryOptions();
  slotPair = createTalkerSlotArrays(opts.planetCap);
  for (let k = 0; k < OR_MAX_ARMS; k++) arms[k] = newArm(k);
  byId.clear(); rateCache.clear(); seen.clear();
  simTime = 0; sizeEma = 600; dtEma = 1 / 60;
  Object.assign(esc, { base: 0, phase: 0, index: 0, len: BEAT_S, tick: 0, angle: 0, anchor: -ANCHOR_AMP, balance: 0, amp: BALANCE_AMP });
  fail.ema = 0; fail.on = false;
  sunGlow = 0.8; audioEma = 0; idleFlag = 0; hudSkipCount = 0;
  sp.active.fill(0); sp.tokens = 0; sp.count = 0;
  cam.init = false; cam.t = 0;
}

function reducedOn(): boolean {
  return opts.reducedMotion === "on";
}

/** Failed state: slow EMA plus hysteresis, so a flapping unit never makes the plaque blink. */
function stepFail(frame: VizDataFrame, dt: number): void {
  const raw = Math.max(0, Math.min(1, frame.sys?.failed ?? 0));
  fail.ema += (raw - fail.ema) * (1 - Math.exp(-dt / 1.5));
  if (!fail.on && fail.ema >= opts.failThreshold) fail.on = true;
  else if (fail.on && fail.ema < opts.failThreshold * 0.7) fail.on = false;
}

function stepEscapement(dt: number): void {
  esc.phase += dt / esc.len;
  esc.tick *= Math.exp(-dt * 6);
  while (esc.phase >= 1) {
    esc.phase -= 1;
    esc.index += 1;
    esc.base += ESC_STEP;
    esc.len = beatLength(esc.index, fail.on, opts.tickRate);
    esc.tick = 1;
  }
  const e = easeStep(esc.phase / STEP_FRAC);
  esc.angle = -(esc.base + ESC_STEP * e);
  const side = esc.index % 2 === 0 ? 1 : -1;
  esc.anchor = side * ANCHOR_AMP * (2 * e - 1);
  esc.amp += ((fail.on ? BALANCE_AMP * FAIL_BALANCE : BALANCE_AMP) - esc.amp) * (1 - Math.exp(-dt * 0.8));
  esc.balance = esc.amp * Math.sin(Math.PI * (esc.index + esc.phase));
}

/** Drive kick: planets move most while the escape wheel steps (mean 1 over a beat). */
function driveKick(): number {
  return esc.phase < 0.3 ? 0.55 + 0.45 * (0.7 / 0.3) : 0.55 + 0.45 * (0.3 / 0.7);
}

function stepTalkers(frame: VizDataFrame, dt: number): void {
  const list = frame.talkers?.length ? frame.talkers : DEMO_TALKERS;
  if (!frame.talkers?.length) {
    // the demo set breathes slowly so the planets visibly change pace
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
  const fade = reducedOn() ? 0.5 : 1;
  for (let k = 0; k < OR_MAX_ARMS; k++) {
    const a = arms[k]!;
    const target = k < cur.length ? cur[k]!.id : null;
    if (a.shown !== target) {
      a.present = Math.max(0, a.present - dt / 0.8 * fade);
      if (a.present <= 0) {
        a.shown = target;
        a.flash = 0;
        const t = target ? seen.get(target) : undefined;
        a.type = t ? planetTypeFor(t) : -1;
        a.rate = t ? t.rate : 0;
        a.rateEma = a.rate;
        a.vol = a.rate * sizeEma;
      }
    } else if (target) {
      a.present = Math.min(1, a.present + dt / 1.2 * fade);
    }
    const t = a.shown ? seen.get(a.shown) : undefined;
    a.rate = t && Number.isFinite(t.rate) ? Math.max(0, t.rate) : 0;
    a.rateEma += (a.rate - a.rateEma) * (1 - Math.exp(-dt / 3));
    a.vol += (a.rate * sizeEma - a.vol) * (1 - Math.exp(-dt / 20));
    const geo = ORRERY.arms[k]!;
    const w = orbitOmega(a.rateEma, geo.radius, opts.orbitSpeed) * (fail.on ? FAIL_DRIVE : 1);
    a.angle = (a.angle + w * dt * driveKick()) % (Math.PI * 2);
    a.spin = (a.spin + dt * (0.25 + 0.6 * Math.min(1, Math.log1p(a.rateEma) / Math.log1p(400))) * (fail.on ? 0.5 : 1)) % (Math.PI * 2);
    a.flash *= Math.exp(-dt * 2.5);
  }
}

/** Gear-train path for a spark bound for arm k (or the sun when k < 0), glTF metres; returns its length. */
function buildPath(k: number): number {
  const g = ORRERY.gears;
  const put = (i: number, x: number, y: number, z: number) => { path[i * 3] = x; path[i * 3 + 1] = y; path[i * 3 + 2] = z; };
  const [ex, ey, ez] = g[3]!.pivot;
  const [g3x, g3y, g3z] = g[2]!.pivot;
  const [g2x, , g2z] = g[1]!.pivot;
  put(0, ex, ey + 0.003, ez);
  put(1, (g3x * g[1]!.radius + g2x * g[2]!.radius) / (g[1]!.radius + g[2]!.radius), g3y + 0.002, (g3z * g[1]!.radius + g2z * g[2]!.radius) / (g[1]!.radius + g[2]!.radius));
  put(2, g2x, g3y + 0.002, g2z);
  const d = Math.hypot(g2x, g2z) || 1;
  put(3, g2x - (g2x / d) * g[1]!.radius, g3y + 0.002, g2z - (g2z / d) * g[1]!.radius);
  put(4, 0, g3y + 0.004, 0);
  let n = 5;
  if (k < 0) {
    put(5, 0, ORRERY.sun.centre[1] - ORRERY.sun.radius, 0);
    n = 6;
  } else {
    const geo = ORRERY.arms[k]!;
    const a = arms[k]!;
    const c = Math.cos(a.angle), s = Math.sin(a.angle);
    put(5, 0, geo.hub, 0);
    put(6, c * geo.radius, geo.hub + 0.003, -s * geo.radius);
    const size = planetRadius(a.vol, opts.planetScale) * a.present;
    put(7, c * geo.radius, geo.hub + ORRERY.postHeight + size, -s * geo.radius);
    n = 8;
  }
  pathN = n;
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const dx = path[(i + 1) * 3]! - path[i * 3]!, dy = path[(i + 1) * 3 + 1]! - path[i * 3 + 1]!, dz = path[(i + 1) * 3 + 2]! - path[i * 3 + 2]!;
    segLen[i] = Math.hypot(dx, dy, dz);
    total += segLen[i]!;
  }
  return total;
}

function pickArm(): number {
  let total = 0;
  for (let k = 0; k < opts.planetCap; k++) {
    const a = arms[k]!;
    const w = a.shown && a.present > 0.5 ? 0.2 + Math.log1p(a.rateEma) : 0;
    a.acc += w;
    total += w;
  }
  if (total <= 0) return -1;
  let best = -1, bestAcc = -Infinity;
  for (let k = 0; k < opts.planetCap; k++) {
    if (arms[k]!.acc > bestAcc && arms[k]!.shown && arms[k]!.present > 0.5) { bestAcc = arms[k]!.acc; best = k; }
  }
  if (best >= 0) arms[best]!.acc -= total;
  return best;
}

function stepSparks(frame: VizDataFrame, dt: number): void {
  const cap = Math.min(OR_MAX_SPARKS, opts.sparks ? opts.sparkCap : 0);
  const pkts = frame.packets ?? [];
  const take = Math.min(pkts.length, orreryWorkBudget().maxPacketsPerFrame);
  if (pkts.length > take) hudSkipCount += pkts.length - take;
  const rate = reducedOn() ? 0.5 : 1;
  sp.tokens = Math.min(3, sp.tokens + dt * (cap / 1.6) * rate);
  for (let i = 0; i < take && sp.tokens >= 1; i++) {
    let slot = -1;
    for (let j = 0; j < cap; j++) if (!sp.active[j]) { slot = j; break; }
    if (slot < 0) break;
    sp.tokens -= 1;
    sp.active[slot] = 1;
    sp.s[slot] = 0;
    sp.arm[slot] = pickArm();
    sp.hue[slot] = fail.on ? FAIL_HUE : sparkHue(pkts[i]!);
  }
  const speed = SPARK_SPEED * (reducedOn() ? 0.65 : 1) * (fail.on ? 0.6 : 1);
  let live = 0;
  for (let j = 0; j < OR_MAX_SPARKS; j++) {
    if (!sp.active[j]) continue;
    if (j >= cap) { sp.active[j] = 0; continue; }
    const k = sp.arm[j]!;
    const total = buildPath(k);
    const n = pathN;
    sp.s[j] = sp.s[j]! + speed * dt;
    if (sp.s[j]! >= total) {
      sp.active[j] = 0;
      if (k >= 0) arms[k]!.flash = Math.min(1, arms[k]!.flash + 0.6);
      continue;
    }
    let rem = sp.s[j]!;
    let seg = 0;
    while (seg < n - 2 && rem > segLen[seg]!) { rem -= segLen[seg]!; seg++; }
    const f = segLen[seg]! > 0 ? Math.min(1, rem / segLen[seg]!) : 0;
    for (let c = 0; c < 3; c++) sp.pos[j * 3 + c] = path[seg * 3 + c]! + (path[(seg + 1) * 3 + c]! - path[seg * 3 + c]!) * f;
    const u = sp.s[j]! / total;
    const inten = Math.min(1, u / 0.06) * (u > 0.85 ? Math.max(0, (1 - u) / 0.15) : 1);
    sp.look[j] = encodeSparkLook(sp.hue[j]!, 0.25 + 0.75 * inten);
    live++;
  }
  sp.count = live;
}

function stepCamera(dt: number): void {
  const { target, distance, elevationDeg, fovDeg } = ORRERY.camera;
  const reduced = reducedOn();
  cam.t += dt;
  const tx: number = target[0], tz: number = target[2];
  let ty: number = target[1], dist: number = distance, el: number = elevationDeg, yaw = 0, amp = 0;
  switch (opts.cameraMode) {
    case "fixed": yaw = 0.08; break;
    case "low": el = 11; dist = 1.15; ty = 0.22; amp = 0.1; break;
    case "top": el = 50; dist = 1.25; ty = 0.14; amp = 0.08; break;
    default: amp = 0.18;
  }
  if (!reduced) yaw += amp * Math.sin((cam.t * Math.PI * 2) / 120);
  const er = (el * Math.PI) / 180;
  want[0] = tx + dist * Math.sin(yaw) * Math.cos(er);
  want[1] = ty + dist * Math.sin(er);
  want[2] = tz + dist * Math.cos(yaw) * Math.cos(er);
  want[3] = tx; want[4] = ty; want[5] = tz; want[6] = fovDeg;
  if (!cam.init) {
    cam.eye.set(want.subarray(0, 3)); cam.aim.set(want.subarray(3, 6)); cam.fov = want[6]!;
    cam.init = true;
    return;
  }
  const k = 1 - Math.exp(-dt * (reduced ? 0.6 : 1.2));
  for (let c = 0; c < 3; c++) {
    cam.eye[c] = cam.eye[c]! + (want[c]! - cam.eye[c]!) * k;
    cam.aim[c] = cam.aim[c]! + (want[3 + c]! - cam.aim[c]!) * k;
  }
  cam.fov += (want[6]! - cam.fov) * k;
}

/** Advance the orrery by one host frame. */
export function ingestFrame(frame: VizDataFrame): void {
  const dt = frame.dt > 0 ? Math.min(frame.dt, 0.1) : 1 / 60;
  const steps = Math.max(1, Math.min(orreryWorkBudget().maxSimStepsPerFrame || 1, Math.ceil(dt / (1 / 30))));
  const h = dt / steps;
  idleFlag = frame.demo ? 1 : 0;
  dtEma += ((frame.dt > 0 ? frame.dt : 1 / 60) - dtEma) * 0.1;
  const pkts = frame.packets ?? [];
  if (pkts.length) {
    let sum = 0, n = 0;
    for (const p of pkts) if (Number.isFinite(p.size) && p.size > 0) { sum += p.size; n++; }
    if (n) sizeEma += (sum / n - sizeEma) * (1 - Math.exp(-dt / 4));
  }
  for (let i = 0; i < steps; i++) {
    simTime += h;
    stepFail(frame, h);
    stepEscapement(h);
    stepTalkers(frame, h);
  }
  stepSparks(frame, dt);
  stepCamera(dt);
  const audio = Math.max(0, Math.min(1, frame.audio || 0));
  audioEma += (audio - audioEma) * (1 - Math.exp(-dt * 2));
  sunGlow = (fail.on ? 0.55 : 0.8) + 0.2 * audioEma;
}

/** Fill the slot buffers (reused every frame). */
export function packOrrerySlots(frame: VizDataFrame): Float32Array[] {
  const hd = slots[0]!;
  hd.fill(0);
  hd[OR_SLOT.mark] = 1;
  hd[OR_SLOT.eyeX] = cam.eye[0]!; hd[OR_SLOT.eyeY] = cam.eye[1]!; hd[OR_SLOT.eyeZ] = cam.eye[2]!;
  hd[OR_SLOT.aimX] = cam.aim[0]!; hd[OR_SLOT.aimY] = cam.aim[1]!; hd[OR_SLOT.aimZ] = cam.aim[2]!;
  hd[OR_SLOT.fov] = cam.fov;
  hd[OR_SLOT.failed] = fail.on ? 1 : 0;
  hd[OR_SLOT.escape] = esc.angle;
  hd[OR_SLOT.anchor] = esc.anchor;
  hd[OR_SLOT.balance] = esc.balance;
  const g = ORRERY.gears;
  hd[OR_SLOT.gear3] = esc.angle;
  hd[OR_SLOT.gear2] = -esc.angle * (g[2]!.teeth / g[1]!.teeth);
  hd[OR_SLOT.gearCrown] = esc.angle * (g[2]!.teeth / g[0]!.teeth);
  hd[OR_SLOT.sun] = sunGlow;
  hd[OR_SLOT.audio] = Math.max(0, Math.min(1, frame.audio || 0));
  hd[OR_SLOT.idle] = idleFlag;
  hd[OR_SLOT.sparks] = sp.count;
  hd[OR_SLOT.tick] = esc.tick;
  hd[OR_SLOT.reduced] = reducedOn() ? 1 : 0;
  hd[OR_SLOT.lowFps] = lowFpsFor(dtEma) ? 1 : 0;
  hd[OR_SLOT.lamp] = opts.lampWarmth * (fail.on ? 0.8 : 1) + 0.1 * audioEma;
  hd[OR_SLOT.failLevel] = fail.ema;
  const ab = slots[OR_ARM_SLOT]!;
  ab.fill(0);
  let shown = 0;
  for (let k = 0; k < OR_MAX_ARMS; k++) {
    const a = arms[k]!;
    const o = k * OR_ARM_FLOATS;
    const geo = ORRERY.arms[k]!;
    const live = k < opts.planetCap;
    ab[o + OR_ARM.angle] = a.angle;
    ab[o + OR_ARM.radius] = geo.radius;
    ab[o + OR_ARM.hub] = geo.hub;
    ab[o + OR_ARM.type] = live && a.shown && a.present > 0 ? a.type : -1;
    ab[o + OR_ARM.size] = live ? planetRadius(a.vol, opts.planetScale) * easeStep(a.present) : 0;
    ab[o + OR_ARM.spin] = a.spin;
    ab[o + OR_ARM.present] = live ? 1 : 0;
    ab[o + OR_ARM.flash] = a.flash;
    if (live) shown++;
  }
  hd[OR_SLOT.arms] = shown;
  for (let m = 0; m < OR_SPARK_SLOTS; m++) slots[OR_SPARK_SLOT0 + m]!.fill(0);
  let n = 0;
  for (let j = 0; j < OR_MAX_SPARKS; j++) {
    if (!sp.active[j]) continue;
    const buf = slots[OR_SPARK_SLOT0 + Math.floor(n / OR_SPARKS_PER_SLOT)]!;
    const o = (n % OR_SPARKS_PER_SLOT) * 4;
    buf[o] = sp.pos[j * 3]!; buf[o + 1] = sp.pos[j * 3 + 1]!; buf[o + 2] = sp.pos[j * 3 + 2]!;
    buf[o + 3] = sp.look[j]!;
    n++;
  }
  hd[OR_SLOT.sparks] = n;
  return slots;
}
