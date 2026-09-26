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

/** Host render-scale governor will replace this (see plugin.yml render.scale follow-up). */
export function fractalRenderScale(): number {
  return 1.0;
}

/**
 * Hard GPU ceilings at render scale 1.0 (locked until VizFrameBudget).
 * TODO(VizFrameBudget): raise FRACTAL_*_CEIL and plugin.yml max; move worst-case GPU test to min render scale.
 */
export const FRACTAL_ITER_CEIL = 8;
export const FRACTAL_STEPS_CEIL = 10;
export const FRACTAL_ZOOM_LOG_LIMIT = 13.8;

/** Slot 0 layout — must match `sky/fragment.glsl`. */
export const FZ_SLOT = {
  camX: 0,
  camY: 1,
  camZ: 2,
  dirX: 3,
  dirY: 4,
  dirZ: 5,
  roll: 6,
  zoomLog: 7,
  fractalType: 8,
  power: 9,
  scale: 10,
  fold: 11,
  maxIterN: 12,
  maxStepsN: 13,
  detail: 14,
  ao: 15,
  shadow: 16,
  glow: 17,
  fog: 18,
  dof: 19,
  palette: 20,
  paletteCycle: 21,
  orbitTrap: 22,
  hue: 23,
  sat: 24,
  bgR: 25,
  bgG: 26,
  bgB: 27,
  morphT: 28,
  morphAmt: 29,
  renderScale: 30,
  juliaCr: 31,
  juliaCi: 32,
  quatC2: 33,
  quatC3: 34,
  audioDrv: 35,
  pingPhase: 36,
  kaleidoSym: 37,
  mandelCx: 38,
  mandelCy: 39,
  mandelScale: 40,
  frameMs: 41,
  mark: 42,
  precisionClamp: 43,
} as const;

export const FZ_SLOT0_FLOATS = 44;

export let fractalHudCaption = "Mandelbulb · Classic Dive";

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

let camX = 0.05;
let camY = 0.02;
let camZ = -0.85;
let zoomLog = -0.35;
let yaw = 0.55;
let pitch = -0.08;
let roll = 0;
let pingPhase = 0;
let morphT = 0;
let pilotSeed = 0.37;
let lastFrameMs = 0;

const PILOT_TARGETS = [
  [-0.745, 0.186],
  [-0.16, 1.0405],
  [-0.235, 0.827],
  [-0.8, 0.156],
  [-1.25, 0.045],
];

export function resetFractalCamera(): void {
  camX = 0.05;
  camY = 0.02;
  camZ = -0.85;
  zoomLog = -0.35;
  yaw = 0.55;
  pitch = -0.08;
  roll = 0;
  pingPhase = 0;
  morphT = 0;
  pilotSeed = 0.37;
}

export function resetFractalDrive(): void {
  resetFractalCamera();
  optsJson = "";
  optsCache = parseFractalOptions();
  lastFrameMs = 0;
  fractalHudCaption = "Mandelbulb · Classic Dive";
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

  if (opts.resetCam) resetFractalCamera();

  let precisionClamp = 0;
  if (zoomLog > FRACTAL_ZOOM_LOG_LIMIT) {
    zoomLog = FRACTAL_ZOOM_LOG_LIMIT;
    precisionClamp = 1;
  }

  const audioDrv = opts.audioReactive ? audio : 0;
  const zoomSign = opts.zoomDir === "out" ? -1 : 1;
  pingPhase += dt * (opts.zoomDir === "pingpong" ? 0.45 : 0);
  const ping = opts.zoomDir === "pingpong" ? Math.sin(pingPhase) : zoomSign;

  const driftOnly = opts.reducedMotion && opts.autoPilot;
  const holdStill = opts.reducedMotion && opts.paused;

  if (!holdStill) {
    const zspd = opts.reducedMotion ? Math.min(opts.zoomSpeed, 0.12) : opts.zoomSpeed;
    if (!driftOnly) zoomLog += dt * zspd * ping * (0.65 + audioDrv * 0.5);
    morphT += dt * (opts.morph ? 0.35 + audioDrv * 0.2 : 0);
    if (!opts.reducedMotion) roll += dt * opts.rollSpeed * (0.5 + audioDrv);
    if (opts.autoPilot) {
      const drift = opts.reducedMotion ? 0.08 : 0.35;
      yaw += dt * opts.rotateSpeed * drift;
      const target = PILOT_TARGETS[Math.floor((t * 0.07 + pilotSeed) % PILOT_TARGETS.length)]!;
      camX += (target[0] * 0.35 - camX) * dt * 0.15;
      camY += (target[1] * 0.2 - camY) * dt * 0.12;
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

  const [dirX, dirY, dirZ] = dirFromAngles(yaw, pitch, roll);
  const step = Math.exp(-zoomLog * 0.35);
  if (!holdStill && !driftOnly) {
    camX += dirX * step * dt * 0.4 * ping;
    camY += dirY * step * dt * 0.4 * ping;
    camZ += dirZ * step * dt * 0.4 * ping;
  }

  const power = opts.morph
    ? opts.power + Math.sin(morphT) * opts.morphAmount * 2
    : opts.power;

  const iter = Math.min(opts.maxIter, FRACTAL_ITER_CEIL);
  const steps = Math.min(opts.maxSteps, FRACTAL_STEPS_CEIL);

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
  slot0[FZ_SLOT.mandelCx] = opts.mandelCx;
  slot0[FZ_SLOT.mandelCy] = opts.mandelCy;
  slot0[FZ_SLOT.mandelScale] = Math.exp(-zoomLog * 0.08) * aspect;
  slot0[FZ_SLOT.frameMs] = lastFrameMs;
  slot0[FZ_SLOT.precisionClamp] = precisionClamp;
  slot0[FZ_SLOT.mark] = 1;

  fractalHudCaption = `${fractalTypeLabel(opts.type)} · ${fractalPresetLabel(opts.preset)}`;
  if (precisionClamp) fractalHudCaption += " · zoom limit";

  const bright = 1.05 + opts.glow * 0.45 + audioDrv * 0.3;
  const accent: [number, number, number] = [
    0.35 + opts.hueShift * 0.2,
    0.55 + opts.saturation * 0.2,
    0.95 - opts.hueShift * 0.15,
  ];

  return { slot0, bright, accent, bg: opts.bg };
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
