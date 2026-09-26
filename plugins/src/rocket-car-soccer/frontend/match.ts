/**
 * Rocket Car Soccer match simulation — fixed timestep, capped substeps, deterministic RNG.
 */

import {
  RCS_BALL_BASE,
  RCS_CAR0,
  RCS_CAR_STRIDE,
  RCS_DEFAULTS,
  RCS_FIXED_DT,
  RCS_FIXED_HZ,
  RCS_MAX_CARS,
  RCS_MAX_PARTICLES,
  RCS_MAX_SUBSTEPS,
  RCS_MAX_TEAM,
  RCS_SLOT,
  RCS_SLOT0_FLOATS,
  RCS_SLOT1_FLOATS,
  RCS_SLOT2_FLOATS,
  packCameraCode,
  packExplodeCode,
  packThemeCode,
  packTrailCode,
  parseRcsOptions,
  rcsTrackGpu,
  type RcsOptions,
} from "./pack";

const GRAV = 18;
const ARENA_HX = 24;
const ARENA_HZ = 14;
const ARENA_HY = 9;
const GOAL_X = 22.5;
const GOAL_W = 5.5;
const GOAL_H = 4;
const CAR_L = 2.2;
const CAR_W = 1.1;
const CAR_H = 0.55;
const BALL_R = 1.05;
const BOOST_MAX = 1.4;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

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
  aiTarget: Vec3;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  life: number;
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
  lastGoalTeam: number;
  particles: Particle[];
  directorCam: number;
  directorT: number;
  simTime: number;
}

let options: RcsOptions = { ...RCS_DEFAULTS };
let state: SimState | null = null;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function len3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function rng(state: SimState): number {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

export function setRcsOptions(o: Record<string, string | undefined>): RcsOptions {
  const next = parseRcsOptions(o);
  const teamChanged = next.teamSize !== options.teamSize;
  options = next;
  if (teamChanged || !state) resetRcsSim(42);
  return options;
}

export function rcsOptionsNow(): RcsOptions {
  return options;
}

export function resetRcsSim(seed = 42): void {
  const n = Math.min(RCS_MAX_CARS, options.teamSize * 2);
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
      boost: 0.2,
      flip: 0,
      team,
      jump: 0,
      onGround: true,
      aiTarget: { x: 0, y: 0, z: 0 },
    });
  }
  state = {
    seed: seed >>> 0,
    cars,
    ball: { pos: { x: 0, y: BALL_R, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    score: [0, 0],
    clock: options.matchSec,
    phase: 0,
    phaseT: 0,
    kickoff: 0,
    lastGoalTeam: -1,
    particles: [],
    directorCam: 0,
    directorT: 0,
    simTime: 0,
  };
  spawnCrowd(state);
}

function spawnCrowd(st: SimState): void {
  const cap = particleCap();
  st.particles = [];
  for (let i = 0; i < cap; i++) {
    st.particles.push({
      x: (rng(st) - 0.5) * ARENA_HX * 1.6,
      y: 4 + rng(st) * 5,
      z: (rng(st) - 0.5) * ARENA_HZ * 1.8,
      life: 0.5 + rng(st) * 0.5,
    });
  }
}

function particleCap(): number {
  return Math.min(RCS_MAX_PARTICLES, Math.round((options.particles / 100) * RCS_MAX_PARTICLES));
}

function resetKickoff(st: SimState): void {
  st.ball = { pos: { x: 0, y: BALL_R, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
  const n = st.cars.length;
  for (let i = 0; i < n; i++) {
    const c = st.cars[i]!;
    const team = c.team;
    const slot = Math.floor(i / 2);
    const side = team === 0 ? -1 : 1;
    c.pos = { x: side * 4, y: 0.4, z: (slot - (options.teamSize - 1) / 2) * 5 };
    c.vel = { x: 0, y: 0, z: 0 };
    c.yaw = team === 0 ? 0 : Math.PI;
    c.boost = 0.25;
    c.flip = 0;
    c.jump = 0;
    c.onGround = true;
  }
  st.kickoff = 1.2;
}

function carAi(c: Car, st: SimState, dt: number): void {
  const ball = st.ball.pos;
  const toBall = { x: ball.x - c.pos.x, y: 0, z: ball.z - c.pos.z };
  const dist = Math.hypot(toBall.x, toBall.z) + 1e-4;
  const wantYaw = Math.atan2(toBall.x, toBall.z);
  let dyaw = wantYaw - c.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const turn = clamp(dyaw, -3 * dt, 3 * dt);
  c.yaw += turn;

  const agg = options.aggress / 100;
  const fwd = { x: Math.sin(c.yaw), y: 0, z: Math.cos(c.yaw) };
  const chase = dist > 2.5 ? 1 : dist > 1.2 ? 0.55 : -0.2;
  const throttle = clamp(chase + agg * 0.35, -0.3, 1.2);
  c.vel.x += fwd.x * throttle * 38 * dt;
  c.vel.z += fwd.z * throttle * 38 * dt;

  if (dist < 8 && rng(st) < agg * dt * 0.4) c.boost = clamp(c.boost + dt * 1.8, 0, BOOST_MAX);
  else c.boost = Math.max(0, c.boost - dt * 0.35);

  if (c.onGround && ball.y > 2.2 && dist < 6 && rng(st) < agg * dt * 0.25) {
    c.vel.y = 9 + agg * 4;
    c.jump = 0.5;
    c.onGround = false;
  }
  if (!c.onGround && c.jump > 0 && rng(st) < dt * 0.8) {
    c.flip = clamp(c.flip + dt * 3, 0, 1);
  }

  const goalX = c.team === 0 ? GOAL_X : -GOAL_X;
  if (Math.abs(c.pos.x) > ARENA_HX - 3 && rng(st) < dt * 0.5) {
    c.vel.x += (goalX - c.pos.x) * 0.02 * agg;
  }
}

function integrateCar(c: Car, dt: number): void {
  c.vel.y -= GRAV * dt;
  const sp = len3(c.vel);
  const boost = 1 + c.boost * 0.45;
  if (sp > 0.01) {
    c.vel.x *= 1 - dt * 0.9;
    c.vel.z *= 1 - dt * 1.1;
    c.vel.x *= boost;
    c.vel.z *= boost;
  }
  c.pos = add(c.pos, scale(c.vel, dt));
  if (c.pos.y < 0.35) {
    c.pos.y = 0.35;
    if (c.vel.y < 0) c.vel.y *= -0.25;
    c.onGround = true;
    c.flip *= 0.85;
  } else c.onGround = false;
  c.pos.x = clamp(c.pos.x, -ARENA_HX + 1, ARENA_HX - 1);
  c.pos.z = clamp(c.pos.z, -ARENA_HZ + 1, ARENA_HZ - 1);
  c.jump = Math.max(0, c.jump - dt);
}

function ballPhysics(st: SimState, dt: number): void {
  const b = st.ball;
  b.vel.y -= GRAV * dt * 0.95;
  b.pos = add(b.pos, scale(b.vel, dt));
  const r = BALL_R * (options.ballSize / 100);
  if (b.pos.y < r) {
    b.pos.y = r;
    b.vel.y *= -0.62;
    b.vel.x *= 0.98;
    b.vel.z *= 0.98;
  }
  b.pos.x = clamp(b.pos.x, -ARENA_HX + r, ARENA_HX - r);
  b.pos.z = clamp(b.pos.z, -ARENA_HZ + r, ARENA_HZ - r);
  if (Math.abs(b.pos.x) > ARENA_HX - r) b.vel.x *= -0.75;
  if (Math.abs(b.pos.z) > ARENA_HZ - r) b.vel.z *= -0.75;
}

function carBallCollide(st: SimState): void {
  const r = BALL_R * (options.ballSize / 100);
  for (const c of st.cars) {
    const dx = st.ball.pos.x - c.pos.x;
    const dy = st.ball.pos.y - c.pos.y;
    const dz = st.ball.pos.z - c.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const minD = r + CAR_L * 0.45;
    if (d >= minD || d < 1e-4) continue;
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const push = (minD - d) * 0.55;
    st.ball.pos.x += nx * push;
    st.ball.pos.y += ny * push;
    st.ball.pos.z += nz * push;
    const rel = {
      x: st.ball.vel.x - c.vel.x,
      y: st.ball.vel.y - c.vel.y,
      z: st.ball.vel.z - c.vel.z,
    };
    const imp = (1 + c.boost * 0.6) * 12;
    st.ball.vel.x += nx * imp - rel.x * 0.2;
    st.ball.vel.y += ny * imp * 0.6;
    st.ball.vel.z += nz * imp - rel.z * 0.2;
  }
}

function checkGoal(st: SimState): boolean {
  const b = st.ball.pos;
  if (Math.abs(b.z) > GOAL_W * 0.45 || b.y > GOAL_H) return false;
  if (b.x > GOAL_X) {
    st.score[0] += 1;
    st.lastGoalTeam = 0;
    return true;
  }
  if (b.x < -GOAL_X) {
    st.score[1] += 1;
    st.lastGoalTeam = 1;
    return true;
  }
  return false;
}

function goalBurst(st: SimState): void {
  st.phase = 1;
  st.phaseT = options.replay ? 2.8 : 1.6;
  for (let i = 0; i < 24; i++) {
    if (st.particles.length >= particleCap()) break;
    st.particles.push({
      x: st.ball.pos.x + (rng(st) - 0.5) * 3,
      y: st.ball.pos.y + rng(st) * 2,
      z: st.ball.pos.z + (rng(st) - 0.5) * 3,
      life: 1,
    });
  }
}

function stepSim(dt: number): void {
  if (!state) resetRcsSim(42);
  const st = state!;
  const speed = options.gameSpeed / 100;
  const subDt = dt * speed;
  st.simTime += subDt;

  if (st.kickoff > 0) {
    st.kickoff = Math.max(0, st.kickoff - subDt);
    packOnly(st, subDt);
    return;
  }

  if (st.phase > 0) {
    st.phaseT -= subDt;
    st.clock = Math.max(0, st.clock - subDt * (st.phase === 1 ? 0.15 : 1));
    for (const p of st.particles) p.life -= subDt * 0.9;
    st.particles = st.particles.filter((p) => p.life > 0.02);
    if (st.phaseT <= 0) {
      st.phase = 0;
      resetKickoff(st);
    }
    packOnly(st, subDt);
    return;
  }

  st.clock = Math.max(0, st.clock - subDt);
  for (const c of st.cars) {
    carAi(c, st, subDt);
    integrateCar(c, subDt);
  }
  ballPhysics(st, subDt);
  carBallCollide(st);
  if (checkGoal(st)) goalBurst(st);

  for (const p of st.particles) {
    p.y += Math.sin(st.simTime * 2 + p.x) * 0.002;
    p.life = clamp(p.life + subDt * 0.01, 0, 1);
  }
}

function packOnly(st: SimState, dt: number): void {
  st.directorT += dt;
  const cut = options.reducedMotion ? options.cutHz * 0.35 : options.cutHz;
  if (st.directorT > 1 / Math.max(0.08, cut)) {
    st.directorT = 0;
    st.directorCam = (st.directorCam + 1) % 4;
  }
}

export function rcsAdvance(realDt: number): void {
  if (!state) resetRcsSim(42);
  let remain = realDt * (options.gameSpeed / 100);
  let subs = 0;
  while (remain > 1e-6 && subs < RCS_MAX_SUBSTEPS) {
    const h = Math.min(remain, RCS_FIXED_DT);
    stepSim(h);
    remain -= h;
    subs++;
  }
}

/** Deterministic sample: fixed seed sim stepped to `t` from zero. */
export function rcsSampleAt(t: number, seed = 42): { ballX: number; ballZ: number; score: [number, number] } {
  setRcsOptions({});
  resetRcsSim(seed);
  let remain = Math.max(0, t);
  while (remain > 1e-8) {
    const h = Math.min(remain, RCS_FIXED_DT);
    rcsAdvance(h);
    remain -= h;
  }
  const st = state!;
  return { ballX: st.ball.pos.x, ballZ: st.ball.pos.z, score: [...st.score] as [number, number] };
}

function cameraPose(st: SimState, aspect: number): {
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number; fov: number; cut: number;
} {
  const rm = options.reducedMotion;
  const cam = options.camera;
  const ball = st.ball.pos;
  let focus = { x: ball.x, y: ball.y + 1, z: ball.z };
  let yaw = 0.6;
  let pitch = -0.35;
  let roll = 0;
  let dist = 28;
  let fov = 0.95;
  let cut = 0;

  const hero = st.cars[0] ?? st.cars[Math.floor(st.cars.length / 2)]!;
  if (cam === "broadcast" || (cam === "director" && st.directorCam === 0)) {
    yaw = 0.85;
    pitch = -0.42;
    dist = 32;
    focus = { x: ball.x * 0.6, y: 2, z: ball.z * 0.5 };
  } else if (cam === "ballcam" || (cam === "director" && st.directorCam === 1)) {
    yaw = hero.yaw + Math.PI;
    pitch = -0.25;
    dist = 9;
    focus = { x: hero.pos.x, y: hero.pos.y + 1.2, z: hero.pos.z };
  } else if (cam === "orbit" || (cam === "director" && st.directorCam === 2)) {
    const ang = st.simTime * (rm ? 0.08 : 0.18);
    yaw = ang;
    pitch = -0.55;
    dist = 36;
  } else if (cam === "director") {
    cut = 1;
    yaw = st.simTime * 0.4;
    pitch = -0.5;
    dist = 24;
  }

  if (st.phase === 1 && options.replay) {
    pitch = -0.65;
    dist = 18;
    fov = 1.1;
  }

  const shake = rm ? 0 : (1 - clamp(st.phaseT, 0, 1)) * 0.04 * (st.phase === 1 ? 1 : 0);
  roll = Math.sin(st.simTime * 11) * shake;
  const cx = focus.x - Math.sin(yaw) * dist;
  const cz = focus.z - Math.cos(yaw) * dist;
  const cy = focus.y - Math.sin(pitch) * dist * 0.7 + 6;
  return { x: cx, y: cy, z: cz, yaw, pitch, roll, fov, cut };
}

export interface RcsFrame {
  slot0: number[];
  slot1: number[];
  slot2: number[];
}

export function rcsPackFrame(aspect = 16 / 9): RcsFrame {
  if (!state) resetRcsSim(42);
  const st = state!;
  const cam = cameraPose(st, aspect);
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
  slot0[RCS_SLOT.slowMo] = st.phase === 1 ? 0.35 : 1;
  slot0[RCS_SLOT.goalFlash] = st.phase === 1 ? clamp(st.phaseT / 2, 0, 1) : 0;
  slot0[RCS_SLOT.aspect] = aspect;
  slot0[RCS_SLOT.theme] = packThemeCode(options.theme);
  slot0[RCS_SLOT.particlePct] = options.particles / 100;
  slot0[RCS_SLOT.cutBlend] = cam.cut;
  slot0[RCS_SLOT.camMode] = packCameraCode(options.camera);
  slot0[RCS_SLOT.trailStyle] = packTrailCode(options.trail);
  slot0[RCS_SLOT.explodeStyle] = packExplodeCode(options.explode);
  slot0[RCS_SLOT.replay] = options.replay ? 1 : 0;
  slot0[RCS_SLOT.matchLen] = options.matchSec;
  slot0[RCS_SLOT.ballScale] = options.ballSize / 100;
  slot0[RCS_SLOT.gameSpeed] = options.gameSpeed / 100;
  slot0[RCS_SLOT.aggress] = options.aggress / 100;
  slot0[RCS_SLOT.shake] = options.reducedMotion ? 0 : 1;
  slot0[RCS_SLOT.carCount] = st.cars.length;

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
    slot1[o + 6] = c.flip;
    slot1[o + 7] = c.team;
    slot1[o + 8] = c.onGround ? 1 : 0;
  }

  const slot2 = new Array<number>(RCS_SLOT2_FLOATS).fill(0);
  const pCap = Math.min(st.particles.length, 16);
  for (let i = 0; i < 16; i++) {
    const base = i * 4;
    if (i < pCap) {
      const p = st.particles[i]!;
      slot2[base] = p.x;
      slot2[base + 1] = p.y;
      slot2[base + 2] = p.z;
      slot2[base + 3] = p.life;
    }
  }

  rcsTrackGpu(3, pCap);
  return { slot0, slot1, slot2 };
}

export function rcsFrame(dt: number, aspect = 16 / 9): RcsFrame {
  rcsAdvance(dt);
  return rcsPackFrame(aspect);
}

export function enforceRcsCaps(opts: RcsOptions): RcsOptions {
  return {
    ...opts,
    teamSize: clamp(Math.round(opts.teamSize), 2, RCS_MAX_TEAM),
    particles: clamp(Math.round(opts.particles), 0, 100),
    gameSpeed: clamp(opts.gameSpeed, 25, 200),
    aggress: clamp(opts.aggress, 0, 100),
    matchSec: clamp(Math.round(opts.matchSec), 60, 900),
    ballSize: clamp(opts.ballSize, 70, 140),
    cutHz: clamp(opts.cutHz, 0.05, 1.5),
  };
}

export function maxSubstepsFor(dt: number): number {
  return Math.min(RCS_MAX_SUBSTEPS, Math.ceil((dt * (options.gameSpeed / 100)) / RCS_FIXED_DT));
}

export { RCS_FIXED_HZ, RCS_MAX_SUBSTEPS, RCS_MAX_CARS, RCS_MAX_TEAM };
