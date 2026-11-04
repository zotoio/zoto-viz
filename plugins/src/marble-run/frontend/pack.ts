/**
 * Marble Run pack: packets become glass marbles on a Blender-modelled track. The host draws the
 * track GLB and the instanced marbles (web/src/graph/marble-run-scenery.ts); this module runs the
 * sim and writes the marble positions, the camera and the strike accents into the viz slots.
 *
 * Slot 0 (MR_SLOT): header, camera, accents. Slots 1..3: 16 marbles each as x, y, z, look,
 * where look = radius in mm + hue (0..1) for a lit marble, or -radius in mm for clear glass.
 */

import type { VizDataFrame, VizPacketSample } from "../../../sdk/viz-contract";
import { MARBLE_DATA_MAPPING, ZOTO_FAIL_RGB, hash01, parseMarbleOptions, type MarbleOptions } from "./config";
import { MarbleSim, SIM_DT, TrackPath } from "./sim";
import { applyPackWorkBudget, marbleWorkBudget, parseMarbleWorkBudgetYaml, resetPackWorkBudget } from "./work-budget";

export type { VizDataFrame, VizPacketSample };
export { MARBLE_DATA_MAPPING, ZOTO_FAIL_RGB, applyPackWorkBudget, marbleWorkBudget, parseMarbleWorkBudgetYaml, resetPackWorkBudget };

export const MR_MARBLE_SLOT0 = 1;
export const MR_MARBLE_SLOTS = 3;
export const MR_MARBLES_PER_SLOT = 16;
export const MR_MARBLE_FLOATS = 4;
export const MR_MAX_MARBLES = MR_MARBLE_SLOTS * MR_MARBLES_PER_SLOT;

export const MR_SLOT = {
  mark: 0,
  camX: 1, camY: 2, camZ: 3,
  aimX: 4, aimY: 5, aimZ: 6,
  fov: 7,
  count: 8,
  bell: 9,
  xylo0: 10, // 8 bars: 10..17
  audio: 18,
  failed: 19,
  lead: 20,
  queued: 21,
} as const;

/** Fail hue (Zoto Fail red) for marbles carried while sys.failed is over the threshold. */
const FAIL_HUE = 0.004;
const QUEUE_CAP = 96;

let track: TrackPath | null = null;
let sim: MarbleSim | null = null;
let opts: MarbleOptions = parseMarbleOptions();
const queueHue = new Float32Array(QUEUE_CAP);
const queueR = new Float32Array(QUEUE_CAP);
let qHead = 0;
let qLen = 0;
let hudSkipCount = 0;
let lastIngest = { consumedPackets: 0, queueFull: 0 };
const bellLevel = { v: 0 };
const xyloLevel = new Float32Array(8);
let rateEma = 0;
let camPhase = 0;
const camPos = new Float32Array(3);
const camAim = new Float32Array(3);
const tmp = new Float32Array(3);
const slots: Float32Array[] = Array.from({ length: 1 + MR_MARBLE_SLOTS }, () => new Float32Array(64));

export function marbleHueForPacket(pkt: VizPacketSample): number {
  return hash01(pkt.proto || "ip");
}

export function isFrameFailed(frame: VizDataFrame, o: MarbleOptions = opts): boolean {
  return (frame.sys?.failed ?? 0) >= o.failThreshold;
}

/** Marble radius (m): 15–20 mm from packet bytes or the normalised field. */
export function marbleRadius(pkt: VizPacketSample, o: MarbleOptions = opts): number {
  const f = o.sizeField === "field" ? Math.min(1, Math.max(0, pkt.field)) : (Math.min(1500, Math.max(32, pkt.size)) - 32) / 1468;
  return 0.015 + f * 0.005;
}

export function marbleOptions(): MarbleOptions { return opts; }
export function marbleHudSkipCount(): number { return hudSkipCount; }
export function marbleIngestStats(): { consumedPackets: number; queueFull: number } { return lastIngest; }
export function marbleQueueLength(): number { return qLen; }

export function marbleSim(): MarbleSim {
  if (!sim) {
    track ??= new TrackPath();
    sim = new MarbleSim(MR_MAX_MARBLES, track);
    sim.recolor = (i) => {
      if (!sim) return;
      if (qLen > 0) {
        sim.hue[i] = queueHue[qHead]!;
        sim.radius[i] = queueR[qHead]!;
        qHead = (qHead + 1) % QUEUE_CAP;
        qLen--;
      } else {
        sim.hue[i] = -1;
        sim.radius[i] = 0.017;
      }
    };
    sim.setCount(Math.min(opts.maxMarbles, MR_MAX_MARBLES));
  }
  return sim;
}

export function setMarbleOptions(next: MarbleOptions): void {
  opts = next;
  sim?.setCount(Math.min(opts.maxMarbles, MR_MAX_MARBLES));
}

export function disposeMarblePack(): void {
  sim = null;
  qHead = 0; qLen = 0; hudSkipCount = 0; rateEma = 0; camPhase = 0;
  camState.init = false; camState.target = -1; camState.fov = WIDE_FOV; camState.sinceCut = 0;
  bellLevel.v = 0; xyloLevel.fill(0);
  lastIngest = { consumedPackets: 0, queueFull: 0 };
  opts = parseMarbleOptions();
}

function enqueue(hue: number, r: number): boolean {
  if (qLen >= QUEUE_CAP) return false;
  const at = (qHead + qLen) % QUEUE_CAP;
  queueHue[at] = hue; queueR[at] = r; qLen++;
  return true;
}

/** Advance the run by one host frame and queue this frame's packets as marble colours. */
export function ingestFrame(frame: VizDataFrame): void {
  const s = marbleSim();
  const dt = frame.dt > 0 ? Math.min(frame.dt, 0.1) : SIM_DT;
  const cap = marbleWorkBudget().maxPacketsPerFrame;
  const failed = isFrameFailed(frame);
  let consumed = 0, full = 0;
  const pkts = frame.packets ?? [];
  const take = Math.min(pkts.length, cap);
  if (pkts.length > cap) hudSkipCount += pkts.length - cap;
  for (let i = 0; i < take; i++) {
    const p = pkts[i]!;
    if (enqueue(failed ? FAIL_HUE : marbleHueForPacket(p), marbleRadius(p))) consumed++;
    else full++;
  }
  // speed by rate: the lift runs faster when packets arrive faster
  rateEma += ((pkts.length / dt) - rateEma) * Math.min(1, dt * 0.5);
  const reduced = opts.reducedMotion === "on";
  s.liftSpeed = reduced ? 0.4 : 0.42 + Math.min(0.5, rateEma / 400);
  s.step(dt, marbleWorkBudget().maxSimStepsPerFrame);
  const decay = Math.exp(-dt * 5);
  bellLevel.v = Math.min(1.5, bellLevel.v * decay + s.bellHits);
  s.bellHits = 0;
  for (let k = 0; k < xyloLevel.length; k++) {
    xyloLevel[k] = Math.min(1.5, xyloLevel[k]! * decay + (s.xyloHits[k] ?? 0));
    if (k < s.xyloHits.length) s.xyloHits[k] = 0;
  }
  lastIngest = { consumedPackets: consumed, queueFull: full };
  updateCamera(s, dt, frame.audio);
}

const WIDE_POS = [0.15, 1.05, 4.15];
const WIDE_AIM = [0.12, 0.78, 0.15];
/** Chase cam: distance behind and height above the marble on the path, look-ahead distance (m). */
export const CHASE_BACK = 0.34;
export const CHASE_UP = 0.11;
export const CHASE_AHEAD = 0.3;
const CHASE_FOV = 58;
const WIDE_FOV = 36;
/** Spring stiffness (rad/s) of the critically damped camera spring. */
const CAM_OMEGA = 5;

/** Camera state: spring position/velocity for eye and aim, the chased marble, and the fov. */
export const camState = {
  pos: new Float32Array(3),
  vel: new Float32Array(3),
  aim: new Float32Array(3),
  aimVel: new Float32Array(3),
  fov: WIDE_FOV,
  target: -1,
  /** Frames since the last hard cut (tests). */
  sinceCut: 0,
  init: false,
};
const want = new Float32Array(6);

/**
 * Pick the marble to chase: keep the current one while it is on the run; once it reaches the
 * lift (or there is none), take the marble that most recently left the lift top.
 */
export function chaseTarget(s: MarbleSim, current: number): number {
  if (current >= 0 && current < s.count && !s.track.onLift(s.s[current]!)) return current;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < s.count; i++) {
    if (s.track.onLift(s.s[i]!)) continue;
    const d = s.track.wrap(s.s[i]! - s.track.liftEnd);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function spring(x: Float32Array, v: Float32Array, o: number, target: Float32Array, to: number, dt: number): void {
  const w = CAM_OMEGA;
  for (let k = 0; k < 3; k++) {
    const err = x[k]! - target[to + k]!;
    v[k] = v[k]! + (-2 * w * v[k]! - w * w * err) * dt;
    x[k] = x[k]! + v[k]! * dt;
  }
  void o;
}

function cut(): void {
  camState.pos[0] = want[0]!; camState.pos[1] = want[1]!; camState.pos[2] = want[2]!;
  camState.aim[0] = want[3]!; camState.aim[1] = want[4]!; camState.aim[2] = want[5]!;
  camState.vel.fill(0); camState.aimVel.fill(0);
  camState.sinceCut = 0;
}

function updateCamera(s: MarbleSim, dt: number, audio: number): void {
  const mode = opts.reducedMotion === "on" ? "wide" : opts.cameraMode;
  camPhase += dt * 0.05;
  want[0] = WIDE_POS[0]!; want[1] = WIDE_POS[1]!; want[2] = WIDE_POS[2]!;
  want[3] = WIDE_AIM[0]!; want[4] = WIDE_AIM[1]!; want[5] = WIDE_AIM[2]!;
  let fov = WIDE_FOV;
  let hard = false;
  if (mode === "chase") {
    const next = chaseTarget(s, camState.target);
    if (next !== camState.target) hard = true; // new marble (or none): cut, never swoop through the board
    camState.target = next;
    if (next >= 0) {
      const sm = s.s[next]!;
      // eye sits on the path behind the marble, raised above the rails: it rides the track, so it
      // never cuts through the structure the marble itself just passed
      s.track.sample(sm - CHASE_BACK, want, 0);
      want[1] = want[1]! + CHASE_UP;
      s.track.sample(sm + CHASE_AHEAD, want, 3);
      fov = CHASE_FOV;
    }
  } else if (mode === "orbit") {
    const a = Math.sin(camPhase * 2) * 0.55;
    want[0] = want[3]! + Math.sin(a) * 4.0; want[2] = want[5]! + Math.cos(a) * 4.0; want[1] = 1.15;
  } else if (mode === "follow") {
    const lead = s.leadIndex();
    if (lead >= 0) {
      s.track.sample(s.s[lead]!, tmp);
      want[3] = want[3]! * 0.55 + tmp[0]! * 0.45; want[4] = want[4]! * 0.55 + tmp[1]! * 0.45; want[5] = want[5]! * 0.55 + tmp[2]! * 0.45;
      want[0] = want[3]! * 0.4 + Math.sin(camPhase) * 0.25; want[1] = want[4]! + 0.45; want[2] = 2.7;
    }
  } else {
    want[0] = want[0]! + Math.sin(camPhase) * 0.12;
  }
  if (mode !== "chase") camState.target = -1;
  if (!camState.init || hard) {
    cut();
    camState.init = true;
  } else {
    const h = Math.min(dt, 0.05);
    spring(camState.pos, camState.vel, 0, want, 0, h);
    spring(camState.aim, camState.aimVel, 0, want, 3, h);
    camState.sinceCut++;
  }
  camState.fov += (fov - camState.fov) * (hard ? 1 : Math.min(1, dt * 4));
  camPos[0] = camState.pos[0]!; camPos[1] = camState.pos[1]!; camPos[2] = camState.pos[2]!;
  camAim[0] = camState.aim[0]!; camAim[1] = camState.aim[1]!; camAim[2] = camState.aim[2]!;
  void audio;
}

/** Fill the slot buffers (reused every frame). */
export function packMarbleSlots(frame: VizDataFrame): Float32Array[] {
  const s = marbleSim();
  const h = slots[0]!;
  h.fill(0);
  h[MR_SLOT.mark] = 1;
  h[MR_SLOT.camX] = camPos[0]!; h[MR_SLOT.camY] = camPos[1]!; h[MR_SLOT.camZ] = camPos[2]!;
  h[MR_SLOT.aimX] = camAim[0]!; h[MR_SLOT.aimY] = camAim[1]!; h[MR_SLOT.aimZ] = camAim[2]!;
  h[MR_SLOT.fov] = camState.fov;
  h[MR_SLOT.count] = s.count;
  h[MR_SLOT.bell] = Math.min(1, bellLevel.v);
  for (let k = 0; k < 8; k++) h[MR_SLOT.xylo0 + k] = Math.min(1, xyloLevel[k]!);
  h[MR_SLOT.audio] = Math.max(0, Math.min(1, frame.audio || 0));
  h[MR_SLOT.failed] = isFrameFailed(frame) ? 1 : 0;
  h[MR_SLOT.lead] = s.leadIndex();
  h[MR_SLOT.queued] = qLen;
  for (let m = 0; m < MR_MARBLE_SLOTS; m++) slots[1 + m]!.fill(0);
  for (let i = 0; i < s.count; i++) {
    const buf = slots[MR_MARBLE_SLOT0 + Math.floor(i / MR_MARBLES_PER_SLOT)]!;
    const o = (i % MR_MARBLES_PER_SLOT) * MR_MARBLE_FLOATS;
    s.track.sample(s.s[i]!, buf, o);
    const mm = Math.round(s.radius[i]! * 1000);
    const hue = s.hue[i]!;
    buf[o + 3] = hue < 0 ? -mm : mm + Math.min(0.999, hue);
    // marbles ride above the path centre by the difference from the design radius
    buf[o + 1] = buf[o + 1]! + (s.radius[i]! - 0.018);
  }
  return slots;
}

/** Decode a marble look float (for the host and tests). */
export function decodeMarbleLook(look: number): { radius: number; hue: number } {
  if (look < 0) return { radius: -look / 1000, hue: -1 };
  const mm = Math.floor(look);
  return { radius: mm / 1000, hue: look - mm };
}
