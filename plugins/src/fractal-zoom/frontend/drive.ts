import {
  CANYON_HOME,
  ORBIT_MAX,
  SEAHORSE_X,
  SEAHORSE_Y,
  type Canyon3,
  type DeParams,
  type Cruise2,
  de3,
  itersForScale,
  packOrbit,
  stepCanyon,
  windowScale,
  zoomLogForWindow,
} from "./cruise";
import { type LoopTarget, loopCatalogue, loopReferenceOrbit } from "../../../sdk/fractal-misiurewicz";
import {
  fractalPresetLabel,
  fractalTypeLabel,
} from "./config-mutation";
import {
  type FractalOptions,
  fractalTypeIndex,
  isPlanarType,
  paletteIndex,
  parseFractalOptions,
} from "./options";
import type { FractalPointerState } from "./interaction";
import { FZ_BAND_WRAP, FZ_SLOT, FZ_SLOT0_FLOATS } from "../../../sdk/fractal-slot";

/** Host render-scale governor will replace this (see plugin.yml render.scale follow-up). */
export function fractalRenderScale(): number {
  return 1.0;
}

/**
 * Hard GPU ceilings (shader + drive min()). Conservative starting point — tune on a real GPU locally;
 * do not gate CI on cloud VM frame times.
 * TODO(VizFrameBudget): tie ceilings to host render-scale governor once it ships.
 */
export const FRACTAL_ITER_CEIL = 96;
export const FRACTAL_STEPS_CEIL = 48;

export { FZ_SLOT, FZ_SLOT0_FLOATS } from "../../../sdk/fractal-slot";

export let fractalHudCaption = "Mandelbrot 2D · Seahorse Valley";

export interface FractalDriveInput {
  t: number;
  dt: number;
  audio: number;
  aspect: number;
  opts: FractalOptions;
  pointer: FractalPointerState;
}

export interface FractalDriveOut {
  slot0: number[];
  /** Reference orbit for deep 2D perturbation, slots 1..5. */
  orbit: number[][];
  bright: number;
  accent: [number, number, number];
  bg: [number, number, number];
}

let optsCache: FractalOptions = parseFractalOptions();
let optsJson = "";

export function setFractalOptions(o: Record<string, string | undefined>): FractalOptions {
  const json = JSON.stringify(o);
  if (json !== optsJson) {
    optsJson = json;
    optsCache = parseFractalOptions(o);
    fractalHudCaption = `${fractalTypeLabel(optsCache.type)} · ${fractalPresetLabel(optsCache.preset)}`;
  }
  return optsCache;
}

export function fractalOptionsNow(): FractalOptions {
  return optsCache;
}

let camX = 0.12;
let camY = 0.22;
let camZ = 2.42;
let zoomLog = -0.35;
let yaw = 0.55;
let pitch = -0.08;
let roll = 0;
let pingPhase = 0;
let morphT = 0;
let lastFrameMs = 0;
let resetCamLatched = false;
let poseKey = "";
let generation = 0;
let cruise: Cruise2 = { x: SEAHORSE_X, y: SEAHORSE_Y, vx: 0, vy: 0, heading: 0.7 };
let canyon: Canyon3 = { ...CANYON_HOME };
/** Last canyon pose whose ray origin was outside the solid, and how long the cruise has been inside. */
let canyonSafe: Canyon3 | null = null;
let canyonInsideS = 0;

/** Mandelbrot terrain opens on the whole set: centre of the cardioid-to-antenna span, window wide enough to hold it. */
export const TERRAIN_HOME = { x: -0.75, y: 0 };
export const TERRAIN_OPEN_SCALE = 0.62;
/** Seconds of overview before the dive reaches full speed. */
export const TERRAIN_INTRO_S = 6;
/** Opening yaw: camera south of the real axis, looking north, so the set lies across the screen. */
const TERRAIN_OPEN_YAW = Math.PI / 2;
let terrainT = 0;
let terrainYaw = TERRAIN_OPEN_YAW;

/**
 * Infinite planar zoom: dive onto a self-similar loop point, loop there (each time the zoom has gone
 * in by |lambda|, jump back out and rotate by arg lambda: the frame is unchanged), then rise and dive
 * to the next. Depth stays inside each point's seamless band, so float precision never runs out.
 */
type JourneyPhase = "dive" | "loop" | "rise";
interface Journey {
  phase: JourneyPhase;
  target: LoopTarget;
  loops: number;
  /** The point just left (rise): the nearer of it and the target is the perturbation reference. */
  from?: LoopTarget;
}
/** Loops at one point before rising to the next. */
export const LOOPS_PER_TARGET = 5;
/** Dive glide toward the target, per second. */
const DIVE_GLIDE = 1.3;
/** While rising, the centre drifts toward the next target at most this many windows per second. */
const RISE_DRIFT = 0.5;
/** Rise until the next target is within this many windows of the centre. */
const RISE_REACH = 0.45;
let journey: Journey | null = null;
let visited: LoopTarget[] = [];
/** View rotation (radians) the loop jumps accumulate; the rise unwinds it. */
let viewRot = 0;
/** Escape-count offset the loop jumps accumulate, mod FZ_BAND_WRAP (see FZ_SLOT.iterShift). */
let iterShift = 0;
const catalogues = new Map<string, LoopTarget[]>();

function catalogueFor(julia?: { x: number; y: number }): LoopTarget[] {
  const key = julia ? `${julia.x}|${julia.y}` : "mandel";
  let cat = catalogues.get(key);
  if (!cat) {
    cat = loopCatalogue(julia).slice(0, 48);
    catalogues.set(key, cat);
  }
  return cat;
}

/** Nearest unvisited target to (x, y); the walk starts over once every target has been seen. */
function nextTarget(x: number, y: number, julia?: { x: number; y: number }, skip?: LoopTarget): LoopTarget | null {
  const cat = catalogueFor(julia);
  if (!cat.length) return null;
  let pool = cat.filter((p) => !visited.includes(p) && p !== skip);
  if (!pool.length) {
    visited = skip ? [skip] : [];
    pool = cat.filter((p) => p !== skip);
  }
  if (!pool.length) pool = cat;
  let best = pool[0]!;
  let bestD = Infinity;
  for (const p of pool) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  visited.push(best);
  return best;
}

function wrapAngle(a: number): number {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Camera clearance the canyon pre-roll waits for (the SDK canyon flies at clearance 0.04). */
export const FRACTAL_PREROLL_CLEARANCE = 0.04;
/** After the pre-roll the camera must keep at least this much room for FRACTAL_PREROLL_SETTLE steps. */
export const FRACTAL_PREROLL_FLOOR = 0.02;
export const FRACTAL_PREROLL_SETTLE = 31;
/** Upper bound on pre-roll steps (dt 1/60 each); the Mandelbulb home needs ~470. */
export const FRACTAL_PREROLL_MAX_STEPS = 1500;
const PREROLL_DT = 1 / 60;
const prerollCache = new Map<string, Canyon3>();

/** Ray-origin room the shader needs; below this the view starts inside the surface (flat colour or black). */
export const CANYON_RO_FLOOR = 0.004;
/** Seconds the cruise may stay inside before the flight restarts from the settled pre-roll pose. */
export const CANYON_INSIDE_RESEED_S = 1.5;

/** Shader ray origin for a canyon pose: `near` back from the focus toward the camera (fragment.glsl). */
export function canyonRayOrigin(c: Canyon3): [number, number, number] {
  const fx = c.fx - c.cx;
  const fy = c.fy - c.cy;
  const fz = c.fz - c.cz;
  const l = Math.hypot(fx, fy, fz) || 1;
  const stand = c.near > 1e-4 ? c.near : Math.max(l, 0.35);
  return [c.fx - (fx / l) * stand, c.fy - (fy / l) * stand, c.fz - (fz / l) * stand];
}

/**
 * The canyon cruise can slip through a thin Mandelbox wall and fly on inside the solid, where every
 * ray starts at distance 0 and the view went black. Show the last outside pose while it is in
 * there, and restart from the pre-roll pose if it does not come out.
 */
export function guardCanyon(next: Canyon3, opts: FractalOptions, dt: number): Canyon3 {
  const kind = fractalTypeIndex(opts.type);
  const [rx, ry, rz] = canyonRayOrigin(next);
  const d = de3(kind, rx, ry, rz, deParams(opts));
  if (Number.isFinite(d) && d > CANYON_RO_FLOOR) {
    canyonSafe = { ...next };
    canyonInsideS = 0;
    return next;
  }
  canyonInsideS += dt;
  if (canyonInsideS > CANYON_INSIDE_RESEED_S || !canyonSafe) {
    canyonInsideS = 0;
    canyon = settledCanyon(opts);
    canyonSafe = { ...canyon };
    return canyon;
  }
  return canyonSafe;
}

function deParams(opts: FractalOptions): DeParams {
  return {
    power: opts.power,
    scale: opts.scale,
    fold: opts.fold,
    sym: opts.kaleidoSym,
    jx: opts.juliaCr,
    jy: opts.juliaCi,
    jz: opts.quatC2,
    jw: opts.quatC3,
  };
}

/**
 * #180: CANYON_HOME (SDK) puts the first stepped canyon camera inside the Mandelbulb
 * (de(cam) -0.0157 at frame 1, still < 0 at frame 60), so the sky is one flat colour for
 * seconds. Step the canyon off-screen from home and start the view at the first pose where
 * the camera has FRACTAL_PREROLL_CLEARANCE and keeps more than FRACTAL_PREROLL_FLOOR for the
 * next FRACTAL_PREROLL_SETTLE steps. Deterministic per fractal type + DE params, so it is cached.
 */
export function settledCanyon(opts: FractalOptions): Canyon3 {
  if (isPlanarType(opts.type)) return { ...CANYON_HOME };
  const kind = fractalTypeIndex(opts.type);
  const params = deParams(opts);
  const key = `${kind}|${params.power}|${params.scale}|${params.fold}|${params.sym}|${params.jx}|${params.jy}|${params.jz}|${params.jw}`;
  const hit = prerollCache.get(key);
  if (hit) return { ...hit };
  let c: Canyon3 = { ...CANYON_HOME };
  let start: Canyon3 | null = null;
  let firstClear: Canyon3 | null = null;
  let run = 0;
  for (let i = 0; i < FRACTAL_PREROLL_MAX_STEPS; i++) {
    c = stepCanyon(c, PREROLL_DT, kind, params, 0);
    const dCam = de3(kind, c.cx, c.cy, c.cz, params);
    if (!Number.isFinite(dCam) || dCam <= FRACTAL_PREROLL_FLOOR) {
      start = null;
      run = 0;
      continue;
    }
    if (!start) {
      if (dCam > FRACTAL_PREROLL_CLEARANCE) {
        start = { ...c };
        firstClear ??= start;
        run = 1;
      }
      continue;
    }
    run += 1;
    if (run >= FRACTAL_PREROLL_SETTLE) break;
  }
  const out = start && run >= FRACTAL_PREROLL_SETTLE ? start : (firstClear ?? c);
  prerollCache.set(key, { ...out });
  return { ...out };
}

function reseedPose(opts: FractalOptions): void {
  const julia = opts.type === "julia2d";
  const terrain = opts.type === "mandel3d";
  cruise = {
    x: julia ? 0 : terrain ? TERRAIN_HOME.x : opts.mandelCx,
    y: julia ? 0 : terrain ? TERRAIN_HOME.y : opts.mandelCy,
    vx: 0,
    vy: 0,
    heading: terrain ? TERRAIN_OPEN_YAW : 0.7,
  };
  canyon = settledCanyon(opts);
  canyonSafe = null;
  canyonInsideS = 0;
  camX = CANYON_HOME.cx;
  camY = CANYON_HOME.cy;
  camZ = CANYON_HOME.cz;
  zoomLog = terrain ? zoomLogForWindow(TERRAIN_OPEN_SCALE, 16 / 10) : -0.35;
  terrainT = 0;
  terrainYaw = TERRAIN_OPEN_YAW;
  journey = null;
  visited = [];
  viewRot = 0;
  iterShift = 0;
  generation = 0;
}

function smoothstep(a: number, b: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

function dampYaw(cur: number, want: number, dt: number, omega: number): number {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-omega * dt));
}

/** 0 at the whole-set overview, 1 once the dive is under way. */
function terrainIntro(): number {
  return smoothstep(TERRAIN_INTRO_S * 0.35, TERRAIN_INTRO_S, terrainT);
}

/** One frame of the planar journey (see Journey). `hold` < 1 slows the dive glide (terrain overview). */
function stepJourney(dt: number, aspect: number, julia: { x: number; y: number } | undefined, hold: number): void {
  if (!(dt > 0)) return;
  const s = windowScale(zoomLog, aspect);
  if (!journey) {
    const target = nextTarget(cruise.x, cruise.y, julia);
    if (!target) return;
    journey = { phase: "dive", target, loops: 0 };
  }
  const T = journey.target;
  let x = cruise.x;
  let y = cruise.y;
  if (journey.phase === "dive") {
    const k = (1 - Math.exp(-dt * DIVE_GLIDE)) * hold;
    x += (T.x - x) * k;
    y += (T.y - y) * k;
    if (s <= T.sTop && Math.hypot(T.x - x, T.y - y) <= s * 0.01) {
      journey.phase = "loop";
      x = T.x;
      y = T.y;
    }
  } else if (journey.phase === "loop") {
    x = T.x;
    y = T.y;
    // One loop = zoom factor |lambda|; windowScale shrinks by e^(-1.25) per unit of zoomLog.
    const step = Math.log(T.mag) / 1.25;
    if (s < T.sTop / T.mag) {
      zoomLog -= step;
      viewRot += T.arg;
      iterShift = (iterShift + T.period) % FZ_BAND_WRAP;
      journey.loops += 1;
      generation += 1;
    } else if (s > T.sTop * 1.0001) {
      zoomLog += step;
      viewRot -= T.arg;
      iterShift = (iterShift - T.period + FZ_BAND_WRAP) % FZ_BAND_WRAP;
    }
    if (journey.loops >= LOOPS_PER_TARGET) {
      const next = nextTarget(T.x, T.y, julia, T);
      if (next) journey = { phase: "rise", target: next, loops: 0, from: T };
      else journey.loops = 0;
    }
  } else {
    // Rise: unwind the loop rotation, drift toward the next target, dive once it is in view.
    viewRot += wrapAngle(-viewRot) * (1 - Math.exp(-dt * 0.8));
    const dx = T.x - x;
    const dy = T.y - y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = Math.min(1, (RISE_DRIFT * s * dt) / d);
      x += dx * k;
      y += dy * k;
    }
    if (Math.hypot(T.x - x, T.y - y) <= RISE_REACH * s || s >= 1.2) journey.phase = "dive";
  }
  const vx = (x - cruise.x) / dt;
  const vy = (y - cruise.y) / dt;
  const heading = Math.hypot(vx, vy) > s * 0.02 ? Math.atan2(vy, vx) : cruise.heading;
  cruise = { x, y, vx, vy, heading };
}

export function resetFractalCamera(): void {
  camX = 0.12;
  camY = 0.22;
  camZ = 2.42;
  zoomLog = -0.35;
  yaw = 0.55;
  pitch = -0.08;
  roll = 0;
  pingPhase = 0;
  morphT = 0;
  poseKey = "";
  generation = 0;
  terrainT = 0;
  terrainYaw = TERRAIN_OPEN_YAW;
  journey = null;
  visited = [];
  viewRot = 0;
  iterShift = 0;
  cruise = { x: SEAHORSE_X, y: SEAHORSE_Y, vx: 0, vy: 0, heading: 0.7 };
  canyon = settledCanyon(optsCache);
  canyonSafe = null;
  canyonInsideS = 0;
}

export function resetFractalDrive(): void {
  optsJson = "";
  optsCache = parseFractalOptions();
  resetFractalCamera();
  lastFrameMs = 0;
  resetCamLatched = false;
  fractalHudCaption = "Mandelbrot 2D · Seahorse Valley";
}

export function getFractalFrameMs(): number {
  return lastFrameMs;
}

function dirFromAngles(y: number, p: number, r: number): [number, number, number] {
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const dx = sy * cp;
  const dy = sp;
  const dz = cy * cp;
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  return [dx * cr + dy * sr, dy * cr - dx * sr, dz];
}

export function fractalDrive(input: FractalDriveInput): FractalDriveOut {
  const { t, dt, audio, aspect, opts, pointer } = input;
  lastFrameMs = dt * 1000;
  const renderScale = fractalRenderScale();

  if (opts.resetCam) {
    if (!resetCamLatched) {
      resetFractalCamera();
      resetCamLatched = true;
    }
  } else {
    resetCamLatched = false;
  }

  const is2dEarly = isPlanarType(opts.type);
  const terrain = opts.type === "mandel3d";
  const pose = `${opts.type}|${opts.preset}|${opts.mandelCx}|${opts.mandelCy}|${opts.juliaCr}|${opts.juliaCi}`;
  if (pose !== poseKey) {
    poseKey = pose;
    reseedPose(opts);
  }

  const precisionClamp = 0;
  const audioDrv = opts.audioReactive ? audio : 0;
  const zoomSign = opts.zoomDir === "out" ? -1 : 1;
  pingPhase += dt * (opts.zoomDir === "pingpong" ? 0.45 : 0);
  const ping = opts.zoomDir === "pingpong" ? Math.sin(pingPhase) : zoomSign;

  const driftOnly = opts.reducedMotion && opts.autoPilot;
  const holdStill = opts.paused || opts.zoomSpeed <= 0;

  if (!holdStill) {
    const zspd = opts.reducedMotion ? Math.min(opts.zoomSpeed, 0.12) : opts.zoomSpeed;
    if (terrain) terrainT += dt;
    // Terrain lingers on the whole set, then the dive ramps up; never fully still so the zoom always advances.
    const ramp = terrain ? 0.12 + 0.88 * terrainIntro() : 1;
    // Planar journey: rise zooms out; a dive already at its target's depth waits for the glide to land.
    let journeyK = 1;
    if (is2dEarly && journey) {
      const s = windowScale(zoomLog, aspect);
      if (journey.phase === "rise") journeyK = -1.6 / Math.max(0.2, Math.abs(ping));
      else if (journey.phase === "dive" && s <= journey.target.sTop) journeyK = 0;
    }
    if (!driftOnly) zoomLog += dt * zspd * ping * ramp * journeyK * (0.65 + audioDrv * 0.5);
    morphT += dt * (opts.morph ? 0.35 + audioDrv * 0.2 : 0);
    if (!opts.reducedMotion) roll += dt * opts.rollSpeed * (0.5 + audioDrv);
    if (opts.autoPilot && !driftOnly) {
      const drift = opts.reducedMotion ? 0.08 : 0.22;
      yaw += dt * opts.rotateSpeed * drift;
    }
  }

  if (!opts.autoPilot && !opts.reducedMotion) {
    yaw += dt * opts.rotateSpeed;
  }
  yaw += pointer.yaw;
  if (terrain) terrainYaw += pointer.yaw;
  pitch = pointer.pitch;
  zoomLog += pointer.zoomWheel;
  pointer.yaw = 0;
  pointer.zoomWheel = 0;

  const is2d = is2dEarly;
  const juliaC = opts.type === "julia2d" ? { x: opts.juliaCr, y: opts.juliaCi } : undefined;
  const glide = opts.autoPilot && !opts.paused && !driftOnly;
  if (is2d && glide) stepJourney(dt, aspect, juliaC, terrain ? terrainIntro() : 1);
  let shown = canyon;
  if (!is2d && glide) {
    canyon = stepCanyon(canyon, dt, fractalTypeIndex(opts.type), {
      power: opts.power,
      scale: opts.scale,
      fold: opts.fold,
      sym: opts.kaleidoSym,
      jx: opts.juliaCr,
      jy: opts.juliaCi,
      jz: opts.quatC2,
      jw: opts.quatC3,
    }, zoomLog);
    shown = guardCanyon(canyon, opts, dt);
    camX = shown.cx;
    camY = shown.cy;
    camZ = shown.cz;
  }

  let terrainLook = 0;
  let terrainAheadX = 0;
  let terrainAheadZ = 0;
  if (terrain) {
    // Camera trails the cruise along its heading, in window-relative units, so the landscape rescales as it dives.
    const intro = terrainIntro();
    const speed = Math.hypot(cruise.vx, cruise.vy) / Math.max(1e-30, windowScale(zoomLog, aspect));
    if (!holdStill && opts.autoPilot && !opts.reducedMotion) {
      terrainYaw += dt * opts.rotateSpeed * 0.18 * (1 - intro);
      if (intro > 0 && speed > 0.02) terrainYaw = dampYaw(terrainYaw, cruise.heading, dt, 0.35 * intro);
    }
    // Overview: high and back over the whole set. Dive: low glide, aiming ahead of the cruise point (~20° down).
    const look = terrainYaw;
    const dist = 2.35 - 0.6 * intro;
    const height = 2.05 - 1.1 * intro + Math.max(0, -pitch) * 0.8;
    const ahead = 0.55 * intro;
    camX = -Math.cos(look) * dist;
    camY = height;
    camZ = Math.sin(look) * dist;
    terrainAheadX = Math.cos(look) * ahead;
    terrainAheadZ = -Math.sin(look) * ahead;
    terrainLook = 0.06 + 0.06 * intro;
  }

  const [dirX, dirY, dirZ] = dirFromAngles(yaw, pitch, roll);
  const cx = is2d ? cruise.x : opts.mandelCx;
  const cy = is2d ? cruise.y : opts.mandelCy;
  const viewScale = windowScale(zoomLog, aspect);

  const power = opts.morph
    ? opts.power + Math.sin(morphT) * opts.morphAmount * 2
    : opts.power;

  const depthIter = Math.round(24 + Math.max(0, zoomLog) * 4.5);
  // Terrain needs more iterations than the 2D floor even wide open, or the bulbs melt into one blob;
  // deeper in it follows itersForScale so the boundary does not read as interior mesa.
  const terrainIter = terrain ? Math.max(64, itersForScale(windowScale(zoomLog, aspect))) : 0;
  const iter = Math.min(FRACTAL_ITER_CEIL, Math.max(opts.maxIter, depthIter, terrainIter));
  const steps = Math.min(opts.maxSteps, FRACTAL_STEPS_CEIL);

  let orbit = packOrbit([]);
  let orbitLen = 0;
  let refDx = 0;
  let refDy = 0;
  // Perturbation reference: the loop point itself. Its orbit lands on a repelling cycle and never
  // escapes, so it serves every pixel at any orbit length.
  if (is2d && journey && viewScale < 0.02) {
    const { target, from } = journey;
    const near = from && Math.hypot(from.x - cx, from.y - cy) < Math.hypot(target.x - cx, target.y - cy) ? from : target;
    const need = Math.min(ORBIT_MAX, Math.max(32, itersForScale(viewScale) + 16));
    const zs = loopReferenceOrbit(near, need, juliaC);
    orbit = packOrbit(zs);
    orbitLen = zs.length;
    refDx = (near.x - cx) / viewScale;
    refDy = (near.y - cy) / viewScale;
  }

  const slot0 = new Array<number>(FZ_SLOT0_FLOATS).fill(0);
  slot0[FZ_SLOT.camX] = camX;
  slot0[FZ_SLOT.camY] = camY;
  slot0[FZ_SLOT.camZ] = camZ;
  slot0[FZ_SLOT.dirX] = dirX;
  slot0[FZ_SLOT.dirY] = dirY;
  slot0[FZ_SLOT.dirZ] = dirZ;
  slot0[FZ_SLOT.roll] = terrain ? 0 : roll;
  slot0[FZ_SLOT.zoomLog] = zoomLog;
  slot0[FZ_SLOT.fractalType] = fractalTypeIndex(opts.type);
  slot0[FZ_SLOT.power] = power;
  slot0[FZ_SLOT.scale] = opts.scale;
  slot0[FZ_SLOT.fold] = opts.fold;
  slot0[FZ_SLOT.maxIterN] = iter / FRACTAL_ITER_CEIL;
  slot0[FZ_SLOT.maxStepsN] = (steps * renderScale) / FRACTAL_STEPS_CEIL;
  slot0[FZ_SLOT.detail] = opts.detail / Math.max(0.25, renderScale);
  slot0[FZ_SLOT.ao] = opts.ao;
  slot0[FZ_SLOT.shadow] = opts.shadow;
  slot0[FZ_SLOT.glow] = Math.max(0.2, opts.glow);
  slot0[FZ_SLOT.fog] = opts.fog;
  slot0[FZ_SLOT.dof] = opts.dof ? 1 : 0;
  slot0[FZ_SLOT.palette] = paletteIndex(opts.palette);
  slot0[FZ_SLOT.paletteCycle] = opts.paletteCycle;
  slot0[FZ_SLOT.orbitTrap] = opts.orbitTrap ? 1 : 0;
  slot0[FZ_SLOT.hue] = opts.hueShift;
  slot0[FZ_SLOT.sat] = opts.saturation;
  slot0[FZ_SLOT.bgR] = opts.bg[0];
  slot0[FZ_SLOT.bgG] = opts.bg[1];
  slot0[FZ_SLOT.bgB] = opts.bg[2];
  slot0[FZ_SLOT.morphT] = morphT;
  slot0[FZ_SLOT.morphAmt] = opts.morphAmount;
  slot0[FZ_SLOT.renderScale] = renderScale;
  slot0[FZ_SLOT.juliaCr] = opts.juliaCr;
  slot0[FZ_SLOT.juliaCi] = opts.juliaCi;
  slot0[FZ_SLOT.quatC2] = opts.quatC2;
  slot0[FZ_SLOT.quatC3] = opts.quatC3;
  slot0[FZ_SLOT.audioDrv] = audioDrv;
  slot0[FZ_SLOT.pingPhase] = pingPhase;
  slot0[FZ_SLOT.kaleidoSym] = opts.kaleidoSym;
  slot0[FZ_SLOT.mandelCx] = cx;
  slot0[FZ_SLOT.mandelCy] = cy;
  slot0[FZ_SLOT.mandelScale] = viewScale;
  slot0[FZ_SLOT.frameMs] = lastFrameMs;
  slot0[FZ_SLOT.precisionClamp] = precisionClamp;
  slot0[FZ_SLOT.mark] = 1;
  slot0[FZ_SLOT.focusX] = terrain ? terrainAheadX : shown.fx;
  slot0[FZ_SLOT.focusY] = terrain ? terrainLook : shown.fy;
  slot0[FZ_SLOT.focusZ] = terrain ? terrainAheadZ : shown.fz;
  slot0[FZ_SLOT.nearDist] = terrain ? 0 : shown.near;
  slot0[FZ_SLOT.orbitLen] = orbitLen;
  slot0[FZ_SLOT.generation] = generation;
  slot0[FZ_SLOT.refDx] = refDx;
  slot0[FZ_SLOT.refDy] = refDy;
  slot0[FZ_SLOT.viewRot] = is2d ? viewRot : 0;
  slot0[FZ_SLOT.iterShift] = is2d ? iterShift : 0;

  fractalHudCaption = `${fractalTypeLabel(opts.type)} · ${fractalPresetLabel(opts.preset)}`;
  if (generation > 0) fractalHudCaption += ` · loop ${generation}`;

  const bright = 1.05 + opts.glow * 0.45 + audioDrv * 0.3;
  const accent: [number, number, number] = [
    0.35 + opts.hueShift * 0.2,
    0.55 + opts.saturation * 0.2,
    0.95 - opts.hueShift * 0.15,
  ];

  return { slot0, orbit, bright, accent, bg: opts.bg };
}

export function packFractalDrive(
  t: number,
  dt: number,
  audio: number,
  aspect: number,
  config: Record<string, string | undefined>,
  pointer: FractalPointerState,
): FractalDriveOut {
  const opts = setFractalOptions(config);
  return fractalDrive({ t, dt, audio, aspect, opts, pointer });
}
