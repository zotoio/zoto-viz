/**
 * Rocket Car Soccer — fixed timestep + accumulator, replay ring, live drive, pooled FX.
 */

import { hostLabelHash, ingestLiveFrame, resetRcsTalkerCacheForTest, type RcsLiveDrive, type VizDataFrame } from "./live";
import { InstancedPool } from "./pools";
import {
  RCS_BALL_BASE,
  RCS_CAR0,
  RCS_CAR_STRIDE,
  RCS_CAPS,
  RCS_DEFAULTS,
  RCS_FIXED_DT,
  RCS_GOAL_CELEBRATION_COOLDOWN_SEC,
  RCS_CHALLENGER_RATE_MARGIN,
  RCS_MAX_CAR_SPEED,
  RCS_MAX_CARS,
  RCS_MIN_DIRECTOR_CUT_SEC,
  RCS_TALKER_SLOT_HOLD_SEC,
  RCS_SLOT,
  RCS_SLOT0_FLOATS,
  RCS_SLOT1_FLOATS,
  RCS_SLOT2_FLOATS,
  packCameraCode,
  packExplodeCode,
  packThemeCode,
  packTrailCode,
  parseRcsOptions,
  type RcsOptions,
} from "./pack";

const GRAV = 18;
const ARENA_HX = 24;
const ARENA_HZ = 14;
const GOAL_X = 22.5;
const GOAL_W = 5.5;
const GOAL_H = 4;
const BALL_R = 1.05;
const BOOST_MAX = 1.5;
const HISTORY_LEN = 240;
const PHASE_PLAY = 0;
const PHASE_GOAL = 1;
const PHASE_REPLAY = 2;

interface Vec3 { x: number; y: number; z: number }

interface Car {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  boost: number;
  flip: number;
  team: number;
  jump: number;
  onGround: boolean;
  hostId: string | null;
  hostLabelHash: number;
}

interface Snap {
  ball: { pos: Vec3; vel: Vec3 };
  cars: Car[];
  score: [number, number];
  clock: number;
  camYaw: number;
  camPitch: number;
  camDist: number;
}

interface SimState {
  seed: number;
  cars: Car[];
  ball: { pos: Vec3; vel: Vec3 };
  score: [number, number];
  clock: number;
  phase: number;
  phaseT: number;
  kickoff: number;
  directorCam: number;
  directorT: number;
  simTime: number;
  failDisplay: number;
  lastCelebrationAt: number;
  celebrationT: number;
  goalPulseBank: number;
  live: RcsLiveDrive;
  historyPrealloc: Snap[];
  historyHead: number;
  replayIdx: number;
  physicsSteps: number;
  accum: number;
  hostToCar: Map<string, number>;
  carToHost: (string | null)[];
  vacantUntil: Map<number, number>;
  carAssignedAt: Map<number, number>;
  maxSpeedSeen: number;
}

let options: RcsOptions = { ...RCS_DEFAULTS };
let state: SimState | null = null;
const particlePool = new InstancedPool(RCS_CAPS.maxParticles);
const trailPool = new InstancedPool(RCS_CAPS.maxTrailSegments);

let mountCount = 0;
let gpuPrograms = 0;
let gpuContexts = 0;
let rafHooks = 0;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function rng(st: SimState): number {
  st.seed = (st.seed * 1664525 + 1013904223) >>> 0;
  return st.seed / 4294967296;
}

function emptyCar(team: number): Car {
  return {
    pos: { x: 0, y: 0.4, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    boost: 0.25,
    flip: 0,
    team,
    jump: 0,
    onGround: true,
    hostId: null,
    hostLabelHash: 0,
  };
}

function buildHistoryRing(maxCars: number): Snap[] {
  return Array.from({ length: HISTORY_LEN }, () => ({
    ball: { pos: { x: 0, y: BALL_R, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    cars: Array.from({ length: maxCars }, (_, i) => emptyCar(i % 2)),
    score: [0, 0] as [number, number],
    clock: 0,
    camYaw: 0.75,
    camPitch: -0.4,
    camDist: 32,
  }));
}

function copyCarInto(dst: Car, src: Car): void {
  dst.pos.x = src.pos.x;
  dst.pos.y = src.pos.y;
  dst.pos.z = src.pos.z;
  dst.vel.x = src.vel.x;
  dst.vel.y = src.vel.y;
  dst.vel.z = src.vel.z;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.boost = src.boost;
  dst.flip = src.flip;
  dst.team = src.team;
  dst.jump = src.jump;
  dst.onGround = src.onGround;
  dst.hostId = src.hostId;
  dst.hostLabelHash = src.hostLabelHash;
}

export function setRcsOptions(o: Record<string, string | undefined>): RcsOptions {
  const next = parseRcsOptions(o);
  const teamChanged = next.teamSize !== options.teamSize;
  const seedChanged = next.seed !== options.seed;
  options = next;
  if (teamChanged || seedChanged || !state) resetRcsSim(options.seed);
  return options;
}

export function rcsOptionsNow(): RcsOptions {
  return options;
}

export function resetRcsSim(seed = options.seed): void {
  resetRcsTalkerCacheForTest();
  const n = Math.min(RCS_CAPS.maxCars, options.teamSize * 2);
  const cars: Car[] = [];
  for (let i = 0; i < n; i++) {
    const team = i % 2;
    const slot = Math.floor(i / 2);
    const side = team === 0 ? -1 : 1;
    cars.push({
      pos: { x: side * 4, y: 0.4, z: (slot - (options.teamSize - 1) / 2) * 5 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: team === 0 ? 0 : Math.PI,
      pitch: 0,
      boost: 0.25,
      flip: 0,
      team,
      jump: 0,
      onGround: true,
      hostId: null,
      hostLabelHash: 0,
    });
  }
  particlePool.warm();
  trailPool.warm();
  state = {
    seed: seed >>> 0,
    cars,
    ball: { pos: { x: 0, y: BALL_R, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    score: [0, 0],
    clock: options.matchSec,
    phase: PHASE_PLAY,
    phaseT: 0,
    kickoff: 1.0,
    directorCam: 0,
    directorT: 0,
    simTime: 0,
    failDisplay: 0,
    lastCelebrationAt: -999,
    celebrationT: 0,
    goalPulseBank: 0,
    live: ingestLiveFrame(undefined),
    historyPrealloc: buildHistoryRing(n),
    historyHead: 0,
    replayIdx: 0,
    physicsSteps: 0,
    accum: 0,
    hostToCar: new Map(),
    carToHost: new Array(n).fill(null),
    vacantUntil: new Map(),
    carAssignedAt: new Map(),
    maxSpeedSeen: 0,
  };
  for (let i = 0; i < 16; i++) {
    particlePool.emit(
      (rng(state!) - 0.5) * ARENA_HX * 1.4,
      4 + rng(state!) * 4,
      (rng(state!) - 0.5) * ARENA_HZ * 1.4,
      0.6,
    );
  }
}

function pushHistory(st: SimState, cam: { yaw: number; pitch: number; dist: number }): void {
  const snap = st.historyPrealloc[st.historyHead % HISTORY_LEN]!;
  snap.ball.pos.x = st.ball.pos.x;
  snap.ball.pos.y = st.ball.pos.y;
  snap.ball.pos.z = st.ball.pos.z;
  snap.ball.vel.x = st.ball.vel.x;
  snap.ball.vel.y = st.ball.vel.y;
  snap.ball.vel.z = st.ball.vel.z;
  for (let i = 0; i < st.cars.length; i++) copyCarInto(snap.cars[i]!, st.cars[i]!);
  snap.score[0] = st.score[0];
  snap.score[1] = st.score[1];
  snap.clock = st.clock;
  snap.camYaw = cam.yaw;
  snap.camPitch = cam.pitch;
  snap.camDist = cam.dist;
  st.historyHead++;
}

function isCarSlotFree(st: SimState, idx: number): boolean {
  if (st.carToHost[idx] !== null) return false;
  const hold = st.vacantUntil.get(idx);
  return hold === undefined || st.simTime >= hold;
}

function allocateCarForHost(st: SimState): number {
  for (let i = 0; i < st.cars.length; i++) {
    if (!isCarSlotFree(st, i)) continue;
    st.vacantUntil.delete(i);
    return i;
  }
  return -1;
}

function bindTalkerToCar(st: SimState, talkerId: string, idx: number, live: RcsLiveDrive): void {
  st.hostToCar.set(talkerId, idx);
  st.carToHost[idx] = talkerId;
  st.carAssignedAt.set(idx, st.simTime);
  const c = st.cars[idx]!;
  c.hostId = talkerId;
  c.hostLabelHash = live.perHostLabel.get(talkerId) ?? hostLabelHash(talkerId);
}

function occupantBoost(st: SimState, carIdx: number): number {
  const id = st.carToHost[carIdx];
  if (!id) return 0;
  return st.live.perHostBoost.get(id) ?? 0;
}

function tryChallengerTakeover(st: SimState, talkerId: string, boost: number, live: RcsLiveDrive): boolean {
  let bestIdx = -1;
  let bestOcc = Infinity;
  for (let i = 0; i < st.cars.length; i++) {
    const occ = st.carToHost[i];
    if (!occ) continue;
    const assigned = st.carAssignedAt.get(i) ?? 0;
    if (st.simTime - assigned < RCS_TALKER_SLOT_HOLD_SEC) continue;
    const ob = occupantBoost(st, i);
    if (boost < ob * RCS_CHALLENGER_RATE_MARGIN) continue;
    if (ob < bestOcc) {
      bestOcc = ob;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return false;
  const prev = st.carToHost[bestIdx]!;
  st.hostToCar.delete(prev);
  const c = st.cars[bestIdx]!;
  c.hostId = null;
  bindTalkerToCar(st, talkerId, bestIdx, live);
  return true;
}

function syncTalkerHosts(st: SimState, live: RcsLiveDrive, dt: number): void {
  const seen = new Set<string>();
  for (const [talkerId, boost] of live.perHostBoost) {
    seen.add(talkerId);
    let idx = st.hostToCar.get(talkerId);
    if (idx === undefined) {
      const slot = allocateCarForHost(st);
      if (slot >= 0) {
        bindTalkerToCar(st, talkerId, slot, live);
        idx = slot;
      } else if (!tryChallengerTakeover(st, talkerId, boost, live)) {
        continue;
      } else {
        idx = st.hostToCar.get(talkerId);
      }
    }
    if (idx === undefined) continue;
    const c = st.cars[idx]!;
    c.hostLabelHash = live.perHostLabel.get(talkerId) ?? c.hostLabelHash;
    const mix = live.demo ? 0.55 : boost;
    c.boost = clamp(c.boost + mix * dt * 0.8, 0, BOOST_MAX);
  }
  for (const [talkerId, idx] of [...st.hostToCar.entries()]) {
    if (seen.has(talkerId)) continue;
    st.hostToCar.delete(talkerId);
    st.carToHost[idx] = null;
    st.carAssignedAt.delete(idx);
    const c = st.cars[idx]!;
    c.hostId = null;
    st.vacantUntil.set(idx, st.simTime + RCS_TALKER_SLOT_HOLD_SEC);
  }
}

function tryStartCelebration(st: SimState, packetEnergy: number): boolean {
  if (st.simTime - st.lastCelebrationAt < RCS_GOAL_CELEBRATION_COOLDOWN_SEC) return false;
  st.lastCelebrationAt = st.simTime;
  st.celebrationT = 1.0;
  const size = clamp(0.15 + packetEnergy * 0.65, 0.15, 1);
  const count = Math.max(8, Math.floor(RCS_CAPS.maxParticles * size));
  particlePool.burst(count, st.ball.pos.x, st.ball.pos.y, st.ball.pos.z, 3 + size * 4, () => rng(st));
  return true;
}

function applyLive(st: SimState, live: RcsLiveDrive, dt: number): void {
  st.live = live;
  syncTalkerHosts(st, live, dt);

  const targetFail = live.failAlert;
  if (targetFail > 0) {
    st.failDisplay += (targetFail - st.failDisplay) * Math.min(1, dt * 2.5);
  } else {
    st.failDisplay *= 1 - Math.min(1, dt * 0.8);
  }

  for (const c of st.cars) {
    if (c.hostId) continue;
    c.boost = clamp(c.boost + (live.demo ? 0.55 : 0.35) * dt * 0.8, 0, BOOST_MAX);
    if (live.eventPulse > 0.5 && rng(st) < live.eventPulse * dt * 0.5) {
      c.vel.y += 4;
    }
  }
  for (const c of st.cars) {
    if (!c.hostId) continue;
    if (live.eventPulse > 0.5 && rng(st) < live.eventPulse * dt * 0.5) {
      c.vel.y += 4;
    }
  }

  if (live.goalPulse > 0 && st.phase === PHASE_PLAY) {
    st.goalPulseBank += live.goalPulse * dt * (0.5 + live.packetsConsumed * 0.08);
    if (st.goalPulseBank > 0.35) {
      if (tryStartCelebration(st, st.goalPulseBank)) {
        st.goalPulseBank = 0;
      }
    }
  }

  if (live.goalPulse > 0 && st.phase === PHASE_PLAY && rng(st) < live.goalPulse * dt * 0.06) {
    st.ball.vel.x += (rng(st) - 0.5) * 4;
  }
}

function resetKickoff(st: SimState): void {
  st.ball = { pos: { x: 0, y: BALL_R, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
  for (let i = 0; i < st.cars.length; i++) {
    const c = st.cars[i]!;
    const team = c.team;
    const slot = Math.floor(i / 2);
    const side = team === 0 ? -1 : 1;
    c.pos = { x: side * 4, y: 0.4, z: (slot - (options.teamSize - 1) / 2) * 5 };
    c.vel = { x: 0, y: 0, z: 0 };
    c.yaw = team === 0 ? 0 : Math.PI;
    c.boost = 0.25;
    c.flip = 0;
    c.onGround = true;
  }
  st.kickoff = 1.0;
}

function carAi(c: Car, st: SimState, dt: number, liveBoost: number): void {
  const ball = st.ball.pos;
  const toBall = { x: ball.x - c.pos.x, y: 0, z: ball.z - c.pos.z };
  const dist = Math.hypot(toBall.x, toBall.z) + 1e-4;
  const wantYaw = Math.atan2(toBall.x, toBall.z);
  let dyaw = wantYaw - c.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  c.yaw += clamp(dyaw, -2.5 * dt, 2.5 * dt);
  const agg = (options.aggress / 100) * (0.7 + liveBoost * 0.6);
  const fwd = { x: Math.sin(c.yaw), y: 0, z: Math.cos(c.yaw) };
  const throttle = clamp(agg + (dist > 3 ? 0.8 : 0.2), 0, 1.2);
  c.vel.x += fwd.x * throttle * 36 * dt;
  c.vel.z += fwd.z * throttle * 36 * dt;
  if (dist < 7) c.boost = clamp(c.boost + dt * 1.2, 0, BOOST_MAX);
  if (c.onGround && ball.y > 2 && dist < 5 && rng(st) < agg * dt * 0.2) {
    c.vel.y = 8 + agg * 3;
    c.onGround = false;
  }
  if (c.boost > 0.35) {
    trailPool.emit(c.pos.x, c.pos.y + 0.2, c.pos.z, c.boost * c.team);
  }
}

function integrateCar(c: Car, st: SimState, dt: number): void {
  c.vel.y -= GRAV * dt;
  const fwd = { x: Math.sin(c.yaw), y: 0, z: Math.cos(c.yaw) };
  const accel = 16 + c.boost * 26;
  c.vel.x += fwd.x * accel * dt;
  c.vel.z += fwd.z * accel * dt;
  c.vel.x *= 1 - dt * 1.15;
  c.vel.z *= 1 - dt * 1.15;
  const spd = Math.hypot(c.vel.x, c.vel.z);
  if (spd > RCS_MAX_CAR_SPEED) {
    const s = RCS_MAX_CAR_SPEED / spd;
    c.vel.x *= s;
    c.vel.z *= s;
  }
  st.maxSpeedSeen = Math.max(st.maxSpeedSeen, Math.hypot(c.vel.x, c.vel.z));
  c.pos.x += c.vel.x * dt;
  c.pos.y += c.vel.y * dt;
  c.pos.z += c.vel.z * dt;
  if (c.pos.y < 0.35) {
    c.pos.y = 0.35;
    if (c.vel.y < 0) c.vel.y *= -0.2;
    c.onGround = true;
  }
  c.pos.x = clamp(c.pos.x, -ARENA_HX + 1, ARENA_HX - 1);
  c.pos.z = clamp(c.pos.z, -ARENA_HZ + 1, ARENA_HZ - 1);
}

function ballStep(st: SimState, dt: number): void {
  const b = st.ball;
  b.vel.y -= GRAV * dt;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.pos.z += b.vel.z * dt;
  const r = BALL_R * (options.ballSize / 100);
  if (b.pos.y < r) {
    b.pos.y = r;
    b.vel.y *= -0.55;
  }
  b.pos.x = clamp(b.pos.x, -ARENA_HX + r, ARENA_HX - r);
  b.pos.z = clamp(b.pos.z, -ARENA_HZ + r, ARENA_HZ - r);
  if (b.pos.x <= -ARENA_HX + r + 1e-4 || b.pos.x >= ARENA_HX - r - 1e-4) b.vel.x *= -0.72;
  if (b.pos.z <= -ARENA_HZ + r + 1e-4 || b.pos.z >= ARENA_HZ - r - 1e-4) b.vel.z *= -0.72;
}

function carBall(st: SimState): void {
  const r = BALL_R * (options.ballSize / 100);
  for (const c of st.cars) {
    const dx = st.ball.pos.x - c.pos.x;
    const dy = st.ball.pos.y - c.pos.y;
    const dz = st.ball.pos.z - c.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= r + 1.2 || d < 1e-4) continue;
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    st.ball.vel.x += nx * (8 + c.boost * 4);
    st.ball.vel.y += ny * 3;
    st.ball.vel.z += nz * (8 + c.boost * 4);
  }
}

function checkGoal(st: SimState): boolean {
  const b = st.ball.pos;
  if (Math.abs(b.z) > GOAL_W * 0.45 || b.y > GOAL_H) return false;
  if (b.x > GOAL_X) {
    st.score[1] += 1;
    return true;
  }
  if (b.x < -GOAL_X) {
    st.score[0] += 1;
    return true;
  }
  return false;
}

function goalCelebrate(st: SimState): void {
  st.phase = PHASE_GOAL;
  st.phaseT = 1.2;
  if (options.replay) {
    st.replayIdx = Math.max(0, st.historyHead - 90);
  }
  tryStartCelebration(st, 1);
}

function physicsStep(st: SimState, dt: number): void {
  st.physicsSteps++;
  for (const c of st.cars) {
    const liveBoost = c.hostId ? (st.live.perHostBoost.get(c.hostId) ?? 0) : 0.35;
    carAi(c, st, dt, liveBoost);
    integrateCar(c, st, dt);
  }
  ballStep(st, dt);
  carBall(st);
  if (checkGoal(st)) goalCelebrate(st);
  st.clock = Math.max(0, st.clock - dt);
}

function directorTick(st: SimState, dt: number): void {
  if (options.reducedMotion) return;
  st.directorT += dt;
  const cut = Math.max(RCS_MIN_DIRECTOR_CUT_SEC, options.minCutSec);
  if (st.directorT >= cut) {
    st.directorT = 0;
    st.directorCam = (st.directorCam + 1) % 3;
  }
}

function sampleReplay(st: SimState, t: number): Snap | null {
  const end = st.historyHead - 1;
  const start = Math.max(0, st.replayIdx);
  if (end <= start) return st.historyPrealloc[end % HISTORY_LEN] ?? null;
  const u = clamp(t, 0, 1);
  const idx = Math.floor(start + (end - start) * (1 - u));
  return st.historyPrealloc[idx % HISTORY_LEN] ?? null;
}

function cameraFromState(st: SimState, snap: Snap | null): {
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number; fov: number;
} {
  const rm = options.reducedMotion;
  const camMode = rm ? "broadcast" : options.camera;
  const ball = snap?.ball.pos ?? st.ball.pos;
  let yaw = snap?.camYaw ?? 0.7;
  let pitch = snap?.camPitch ?? -0.38;
  let dist = snap?.camDist ?? 30;
  let roll = 0;

  if (camMode === "broadcast" || (camMode === "director" && st.directorCam === 0)) {
    yaw = 0.75;
    pitch = -0.4;
    dist = 32;
  } else if (camMode === "ballcam" || (camMode === "director" && st.directorCam === 1)) {
    const h = st.cars[0]!;
    yaw = h.yaw + Math.PI;
    pitch = -0.22;
    dist = 10;
  } else if (camMode === "orbit" || (camMode === "director" && st.directorCam === 2)) {
    yaw = st.simTime * (rm ? 0.04 : 0.12);
    pitch = -0.5;
    dist = 34;
  }

  if (st.phase === PHASE_REPLAY && snap) {
    pitch = -0.55;
    dist = 20;
    yaw = snap.camYaw;
  }

  const cx = ball.x - Math.sin(yaw) * dist;
  const cz = ball.z - Math.cos(yaw) * dist;
  const cy = ball.y - Math.sin(pitch) * dist * 0.65 + 7;
  return { x: cx, y: cy, z: cz, yaw, pitch, roll, fov: 0.95 };
}

export interface RcsTickOut {
  slot0: number[];
  slot1: number[];
  slot2: number[];
  particles: number[];
  trails: number[];
  budget: RcsWorkBudget;
}

export interface RcsWorkBudget {
  drawCalls: number;
  particles: number;
  trailSegments: number;
  physicsSubsteps: number;
}

export function rcsTick(frame: VizDataFrame | undefined, simTime: number, dt: number, aspect: number): RcsTickOut {
  if (!state) resetRcsSim(options.seed);
  const st = state!;
  st.simTime = simTime;
  const live = ingestLiveFrame(frame);
  applyLive(st, live, dt);
  particlePool.tick(dt, 0.9);
  trailPool.tick(dt, 1.4);

  let substeps = 0;
  const speed = options.gameSpeed / 100;
  st.accum += Math.max(0, dt) * speed;
  const replayActive = st.phase === PHASE_REPLAY;

  if (!replayActive && st.phase !== PHASE_GOAL && st.kickoff <= 0) {
    const histCam = { yaw: 0.75, pitch: -0.4, dist: 32 };
    while (st.accum >= RCS_FIXED_DT && substeps < RCS_CAPS.maxPhysicsSubsteps) {
      physicsStep(st, RCS_FIXED_DT);
      pushHistory(st, histCam);
      st.accum -= RCS_FIXED_DT;
      substeps++;
    }
    if (substeps >= RCS_CAPS.maxPhysicsSubsteps && st.accum >= RCS_FIXED_DT) {
      st.accum = Math.min(st.accum, RCS_FIXED_DT);
    }
  } else {
    st.accum = Math.min(st.accum, RCS_FIXED_DT);
  }

  if (st.kickoff > 0) st.kickoff = Math.max(0, st.kickoff - dt);

  if (st.phase === PHASE_GOAL) {
    st.phaseT -= dt;
    if (st.failDisplay < 0.35) {
      /* capped celebration — never full-white flash */
    }
    if (st.phaseT <= 0) {
      if (options.replay && st.historyHead > 10) {
        st.phase = PHASE_REPLAY;
        st.phaseT = 2.5;
      } else {
        st.phase = PHASE_PLAY;
        resetKickoff(st);
      }
    }
  } else if (st.phase === PHASE_REPLAY) {
    st.phaseT -= dt;
    const u = 1 - clamp(st.phaseT / 2.5, 0, 1);
    const snap = sampleReplay(st, u);
    if (snap) {
      st.ball.pos.x = snap.ball.pos.x;
      st.ball.pos.y = snap.ball.pos.y;
      st.ball.pos.z = snap.ball.pos.z;
      st.ball.vel.x = 0;
      st.ball.vel.y = 0;
      st.ball.vel.z = 0;
      for (let i = 0; i < st.cars.length; i++) copyCarInto(st.cars[i]!, snap.cars[i]!);
      st.score[0] = snap.score[0];
      st.score[1] = snap.score[1];
      st.clock = snap.clock;
    }
    if (st.phaseT <= 0) {
      st.phase = PHASE_PLAY;
      resetKickoff(st);
    }
  }

  directorTick(st, dt);
  if (st.celebrationT > 0) st.celebrationT = Math.max(0, st.celebrationT - dt);

  const snap = st.phase === PHASE_REPLAY ? sampleReplay(st, 1 - clamp(st.phaseT / 2.5, 0, 1)) : null;
  const cam = cameraFromState(st, snap);

  const failShown = st.failDisplay;
  const rm = options.reducedMotion ? 1 : 0;
  const goalFlash =
    (st.phase === PHASE_GOAL || st.celebrationT > 0) && failShown < 0.35
      ? rm > 0.5
        ? 0.12
        : clamp((st.phase === PHASE_GOAL ? st.phaseT / 1.2 : st.celebrationT) * 0.22, 0, 0.22)
      : 0;

  const slot0 = new Array<number>(RCS_SLOT0_FLOATS).fill(0);
  slot0[RCS_SLOT.mark] = 1;
  slot0[RCS_SLOT.camX] = cam.x;
  slot0[RCS_SLOT.camY] = cam.y;
  slot0[RCS_SLOT.camZ] = cam.z;
  slot0[RCS_SLOT.camYaw] = cam.yaw;
  slot0[RCS_SLOT.camPitch] = cam.pitch;
  slot0[RCS_SLOT.camRoll] = cam.roll;
  slot0[RCS_SLOT.camFov] = cam.fov;
  slot0[RCS_SLOT.clock] = st.clock;
  slot0[RCS_SLOT.scoreOrange] = st.score[0];
  slot0[RCS_SLOT.scoreBlue] = st.score[1];
  slot0[RCS_SLOT.phase] = st.phase;
  slot0[RCS_SLOT.slowMo] = st.phase === PHASE_REPLAY ? 0.5 : 1;
  slot0[RCS_SLOT.goalFlash] = goalFlash;
  slot0[RCS_SLOT.aspect] = aspect;
  slot0[RCS_SLOT.theme] = packThemeCode(options.theme);
  slot0[RCS_SLOT.particlePct] = options.particles / 100;
  slot0[RCS_SLOT.cutBlend] = 0;
  slot0[RCS_SLOT.camMode] = packCameraCode(options.reducedMotion ? "broadcast" : options.camera);
  slot0[RCS_SLOT.trailStyle] = packTrailCode(options.trail);
  slot0[RCS_SLOT.explodeStyle] = packExplodeCode(options.explode);
  slot0[RCS_SLOT.replay] = options.replay ? 1 : 0;
  slot0[RCS_SLOT.matchLen] = options.matchSec;
  slot0[RCS_SLOT.ballScale] = options.ballSize / 100;
  slot0[RCS_SLOT.gameSpeed] = options.gameSpeed / 100;
  slot0[RCS_SLOT.aggress] = options.aggress / 100;
  slot0[RCS_SLOT.shake] = rm;
  slot0[RCS_SLOT.carCount] = st.cars.length;
  slot0[RCS_SLOT.failAlert] = failShown;
  slot0[RCS_SLOT.demoFlag] = st.live.demo ? 1 : 0;
  slot0[RCS_SLOT.flowMetric] = st.live.flowMetric;
  slot0[RCS_SLOT.presetCode] = presetCode(options.preset);
  slot0[RCS_SLOT.hudSeed] = options.seed % 997;

  const slot1 = new Array<number>(RCS_SLOT1_FLOATS).fill(0);
  slot1[RCS_BALL_BASE] = st.ball.pos.x;
  slot1[RCS_BALL_BASE + 1] = st.ball.pos.y;
  slot1[RCS_BALL_BASE + 2] = st.ball.pos.z;
  slot1[RCS_BALL_BASE + 3] = st.ball.vel.x;
  slot1[RCS_BALL_BASE + 4] = st.ball.vel.y;
  slot1[RCS_BALL_BASE + 5] = st.ball.vel.z;
  for (let i = 0; i < st.cars.length && i < RCS_MAX_CARS; i++) {
    const c = st.cars[i]!;
    const o = RCS_CAR0 + i * RCS_CAR_STRIDE;
    slot1[o] = c.pos.x;
    slot1[o + 1] = c.pos.y;
    slot1[o + 2] = c.pos.z;
    slot1[o + 3] = c.yaw;
    slot1[o + 4] = c.pitch;
    slot1[o + 5] = c.boost;
    slot1[o + 6] = c.hostLabelHash;
    slot1[o + 7] = c.team;
    slot1[o + 8] = c.onGround ? 1 : 0;
  }

  const slot2 = new Array<number>(RCS_SLOT2_FLOATS).fill(0);
  const crowd = particlePool.pack(4);
  for (let i = 0; i < Math.min(16, crowd.length / 4); i++) {
    const b = i * 4;
    slot2[b] = crowd[b] ?? 0;
    slot2[b + 1] = crowd[b + 1] ?? 0;
    slot2[b + 2] = crowd[b + 2] ?? 0;
    slot2[b + 3] = crowd[b + 3] ?? 0;
  }

  const budget: RcsWorkBudget = {
    drawCalls: 8 + Math.ceil(particlePool.activeCount() / 16),
    particles: particlePool.activeCount(),
    trailSegments: trailPool.activeCount(),
    physicsSubsteps: substeps,
  };

  return {
    slot0,
    slot1,
    slot2,
    particles: particlePool.pack(4),
    trails: trailPool.pack(4),
    budget,
  };
}

function presetCode(p: string): number {
  if (p === "neon_night") return 1;
  if (p === "chaos_3v3") return 2;
  if (p === "chill_orbit") return 3;
  return 0;
}

export function rcsSampleAt(t: number, seed = 42): { ballX: number; ballZ: number; score: [number, number] } {
  resetRcsSim(seed);
  let remain = t;
  while (remain > 0) {
    const dt = Math.min(remain, 1 / 60);
    rcsTick(undefined, t - remain, dt, 1.777);
    remain -= dt;
  }
  const st = state!;
  return { ballX: st.ball.pos.x, ballZ: st.ball.pos.z, score: [...st.score] as [number, number] };
}

export function enforceRcsCaps(opts: RcsOptions): RcsOptions {
  return parseRcsOptions({
    teamSize: String(opts.teamSize),
    seed: String(opts.seed),
    minCutSec: String(opts.minCutSec),
    particles: String(opts.particles),
    gameSpeed: String(opts.gameSpeed),
  });
}

export function maxSubstepsFor(dt: number): number {
  return Math.min(RCS_CAPS.maxPhysicsSubsteps, Math.ceil((dt * (options.gameSpeed / 100)) / RCS_FIXED_DT));
}

export function rcsPoolStats(): { particleAllocs: number; trailAllocs: number } {
  return {
    particleAllocs: particlePool.allocsAfterWarm,
    trailAllocs: trailPool.allocsAfterWarm,
  };
}

export function rcsTriggerMaxGoalExplosion(): void {
  if (!state) resetRcsSim(options.seed);
  tryStartCelebration(state!, 1);
}

export function rcsPhysicsSteps(): number {
  return state?.physicsSteps ?? 0;
}

/** Test-only: enter replay from recorded history without running extra physics. */
export function rcsEnterReplayForTest(): void {
  if (!state) resetRcsSim(options.seed);
  const st = state!;
  for (let i = 0; i < 30; i++) {
    physicsStep(st, RCS_FIXED_DT);
    pushHistory(st, { yaw: 0.75, pitch: -0.4, dist: 32 });
  }
  const stepsBefore = st.physicsSteps;
  st.phase = PHASE_REPLAY;
  st.phaseT = 2.0;
  st.replayIdx = Math.max(0, st.historyHead - 20);
  for (let i = 0; i < 45; i++) {
    rcsTick(undefined, 3 + i / 60, 1 / 60, 1.777);
  }
  if (st.physicsSteps !== stepsBefore) {
    throw new Error(`replay reran physics: ${st.physicsSteps} vs ${stepsBefore}`);
  }
}

export function rcsMount(): void {
  mountCount++;
  gpuPrograms = 1;
  gpuContexts = 1;
  rafHooks = 1;
  resetRcsSim(options.seed);
}

export function rcsUnmount(): {
  buffers: number;
  programs: number;
  contexts: number;
  raf: number;
  mounts: number;
} {
  const out = {
    buffers: mountCount > 0 ? 3 : 0,
    programs: gpuPrograms,
    contexts: gpuContexts,
    raf: rafHooks,
    mounts: mountCount,
  };
  state = null;
  mountCount = 0;
  gpuPrograms = 0;
  gpuContexts = 0;
  rafHooks = 0;
  return out;
}

export function rcsWorkBudgetAtPreset(preset: string): RcsWorkBudget {
  setRcsOptions({ preset, particles: "100", gameSpeed: "200" });
  resetRcsSim(1);
  rcsTriggerMaxGoalExplosion();
  for (let i = 0; i < 90; i++) rcsTick(undefined, i / 60, 1 / 60, 1.777);
  const b = rcsTick(undefined, 2, 1 / 60, 1.777).budget;
  return b;
}

export function rcsHostCarIndex(hostId: string): number | undefined {
  return state?.hostToCar.get(hostId);
}

export function rcsCarHostLabelHash(carIndex: number): number {
  return state?.cars[carIndex]?.hostLabelHash ?? -1;
}

export function rcsLivePacketsConsumed(): number {
  return state?.live.packetsConsumed ?? 0;
}

export function rcsSimAccumulator(): number {
  return state?.accum ?? 0;
}

export function rcsObservedMaxCarSpeed(): number {
  return state?.maxSpeedSeen ?? 0;
}

export function rcsTestSkipKickoff(): void {
  if (state) state.kickoff = 0;
}

export function rcsRunBoostSteps(steps: number): number {
  if (!state) resetRcsSim(1);
  const st = state!;
  for (const c of st.cars) c.boost = BOOST_MAX;
  const histCam = { yaw: 0.75, pitch: -0.4, dist: 32 };
  for (let i = 0; i < steps; i++) {
    for (const c of st.cars) {
      carAi(c, st, RCS_FIXED_DT, 1);
      integrateCar(c, st, RCS_FIXED_DT);
    }
    pushHistory(st, histCam);
  }
  return st.maxSpeedSeen;
}

export function rcsFailDisplay(): number {
  return state?.failDisplay ?? 0;
}

export function rcsLastCelebrationAt(): number {
  return state?.lastCelebrationAt ?? -999;
}

export function rcsCarAssignedAt(carIdx: number): number {
  return state?.carAssignedAt.get(carIdx) ?? -1;
}

export { RCS_CAPS };
