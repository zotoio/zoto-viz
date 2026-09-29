import {
  CANYON_HOME,
  ORBIT_MAX,
  SEAHORSE_X,
  SEAHORSE_Y,
  type Canyon3,
  type Cruise2,
  itersForScale,
  packOrbit,
  referenceOrbit,
  steerEdge,
  stepCanyon,
  tryRenormalize,
  windowScale,
  zoomLogForWindow,
} from "./cruise";
import {
  fractalPresetLabel,
  fractalTypeLabel,
} from "./config-mutation";
import {
  type FractalOptions,
  fractalTypeIndex,
  paletteIndex,
  parseFractalOptions,
} from "./options";
import type { FractalPointerState } from "./interaction";
import { FZ_SLOT, FZ_SLOT0_FLOATS } from "../../../sdk/fractal-slot";

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
let lastRebaseT = -10;
let cruise: Cruise2 = { x: SEAHORSE_X, y: SEAHORSE_Y, vx: 0, vy: 0, heading: 0.7 };
let canyon: Canyon3 = { ...CANYON_HOME };

function reseedPose(opts: FractalOptions): void {
  const julia = opts.type === "julia2d";
  cruise = {
    x: julia ? 0 : opts.mandelCx,
    y: julia ? 0 : opts.mandelCy,
    vx: 0,
    vy: 0,
    heading: 0.7,
  };
  canyon = { ...CANYON_HOME };
  camX = CANYON_HOME.cx;
  camY = CANYON_HOME.cy;
  camZ = CANYON_HOME.cz;
  zoomLog = -0.35;
  generation = 0;
  lastRebaseT = -10;
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
  lastRebaseT = -10;
  cruise = { x: SEAHORSE_X, y: SEAHORSE_Y, vx: 0, vy: 0, heading: 0.7 };
  canyon = { ...CANYON_HOME };
}

export function resetFractalDrive(): void {
  resetFractalCamera();
  optsJson = "";
  optsCache = parseFractalOptions();
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

  const is2dEarly = opts.type === "mandel2d" || opts.type === "julia2d";
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
    if (!driftOnly) zoomLog += dt * zspd * ping * (0.65 + audioDrv * 0.5);
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
  pitch = pointer.pitch;
  zoomLog += pointer.zoomWheel;
  pointer.yaw = 0;
  pointer.zoomWheel = 0;

  const is2d = is2dEarly;
  const juliaC = opts.type === "julia2d" ? { x: opts.juliaCr, y: opts.juliaCi } : undefined;
  const glide = opts.autoPilot && !opts.paused && !driftOnly;
  if (is2d && glide) {
    const probeIter = Math.min(64, Math.max(24, itersForScale(windowScale(zoomLog, aspect))));
    cruise = steerEdge(cruise, windowScale(zoomLog, aspect), dt, probeIter, juliaC);
    if (t - lastRebaseT > 2.2 && windowScale(zoomLog, aspect) < 2e-4) {
      const chart = tryRenormalize(cruise.x, cruise.y, windowScale(zoomLog, aspect));
      if (chart) {
        cruise = { x: chart.x, y: chart.y, vx: 0, vy: 0, heading: cruise.heading };
        zoomLog = zoomLogForWindow(chart.scale, aspect);
        generation += 1;
        lastRebaseT = t;
      }
    }
  }
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
    camX = canyon.cx;
    camY = canyon.cy;
    camZ = canyon.cz;
  }

  const [dirX, dirY, dirZ] = dirFromAngles(yaw, pitch, roll);
  const cx = is2d ? cruise.x : opts.mandelCx;
  const cy = is2d ? cruise.y : opts.mandelCy;
  const viewScale = windowScale(zoomLog, aspect);

  const power = opts.morph
    ? opts.power + Math.sin(morphT) * opts.morphAmount * 2
    : opts.power;

  const depthIter = Math.round(24 + Math.max(0, zoomLog) * 4.5);
  const iter = Math.min(FRACTAL_ITER_CEIL, Math.max(opts.maxIter, depthIter));
  const steps = Math.min(opts.maxSteps, FRACTAL_STEPS_CEIL);

  let orbit = packOrbit([]);
  let orbitLen = 0;
  if (is2d && viewScale < 5e-4) {
    const need = Math.min(ORBIT_MAX, Math.max(32, itersForScale(viewScale)));
    const zs = referenceOrbit(cx, cy, need, juliaC);
    orbit = packOrbit(zs);
    orbitLen = zs.length;
  }

  const slot0 = new Array<number>(FZ_SLOT0_FLOATS).fill(0);
  slot0[FZ_SLOT.camX] = camX;
  slot0[FZ_SLOT.camY] = camY;
  slot0[FZ_SLOT.camZ] = camZ;
  slot0[FZ_SLOT.dirX] = dirX;
  slot0[FZ_SLOT.dirY] = dirY;
  slot0[FZ_SLOT.dirZ] = dirZ;
  slot0[FZ_SLOT.roll] = roll;
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
  slot0[FZ_SLOT.focusX] = canyon.fx;
  slot0[FZ_SLOT.focusY] = canyon.fy;
  slot0[FZ_SLOT.focusZ] = canyon.fz;
  slot0[FZ_SLOT.nearDist] = canyon.near;
  slot0[FZ_SLOT.orbitLen] = orbitLen;
  slot0[FZ_SLOT.generation] = generation;

  fractalHudCaption = `${fractalTypeLabel(opts.type)} · ${fractalPresetLabel(opts.preset)}`;
  if (generation > 0) fractalHudCaption += ` · gen ${generation}`;

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
