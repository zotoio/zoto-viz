import {
  type FractalOptions,
  fractalTypeIndex,
  paletteIndex,
  parseFractalOptions,
} from "./options";
import type { FractalPointerState } from "./interaction";

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
} as const;

export const FZ_SLOT0_FLOATS = 43;

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
let adaptiveScale = 1;

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
  adaptiveScale = 1;
}

export function getFractalFrameMs(): number {
  return lastFrameMs;
}

export function getFractalAdaptiveScale(): number {
  return adaptiveScale;
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

  const budgetMs = 14;
  if (dt > 0) {
    if (lastFrameMs > budgetMs * 1.35) adaptiveScale = Math.max(0.25, adaptiveScale * 0.92);
    else if (lastFrameMs < budgetMs * 0.75) adaptiveScale = Math.min(opts.renderScale, adaptiveScale * 1.04);
  }
  const renderScale = Math.min(opts.renderScale, adaptiveScale);

  if (opts.resetCam) resetFractalCamera();

  const audioDrv = opts.audioReactive ? audio : 0;
  const zoomSign = opts.zoomDir === "out" ? -1 : 1;
  pingPhase += dt * (opts.zoomDir === "pingpong" ? 0.45 : 0);
  const ping = opts.zoomDir === "pingpong" ? Math.sin(pingPhase) : zoomSign;

  if (!opts.paused) {
    const zspd = opts.reducedMotion ? opts.zoomSpeed * 0.25 : opts.zoomSpeed;
    zoomLog += dt * zspd * ping * (0.65 + audioDrv * 0.5);
    morphT += dt * (opts.morph ? 0.35 + audioDrv * 0.2 : 0);
    roll += dt * opts.rollSpeed * (0.5 + audioDrv);
    if (opts.autoPilot && !opts.manualOrbit) {
      yaw += dt * opts.rotateSpeed * 0.35;
      const target = PILOT_TARGETS[Math.floor((t * 0.07 + pilotSeed) % PILOT_TARGETS.length)]!;
      camX += (target[0] * 0.35 - camX) * dt * 0.15;
      camY += (target[1] * 0.2 - camY) * dt * 0.12;
    }
  }

  if (opts.manualOrbit || pointer.dragging) {
    yaw += pointer.yaw;
    pitch = pointer.pitch;
    zoomLog += pointer.zoomWheel;
    pointer.yaw = 0;
    pointer.zoomWheel = 0;
  } else if (!opts.autoPilot) {
    yaw += dt * opts.rotateSpeed;
  }

  const [dirX, dirY, dirZ] = dirFromAngles(yaw, pitch, roll);
  const step = Math.exp(-zoomLog * 0.35);
  camX += dirX * step * dt * 0.4 * ping;
  camY += dirY * step * dt * 0.4 * ping;
  camZ += dirZ * step * dt * 0.4 * ping;

  const power = opts.morph
    ? opts.power + Math.sin(morphT) * opts.morphAmount * 2
    : opts.power;

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
  slot0[FZ_SLOT.maxIterN] = opts.maxIter / 160;
  slot0[FZ_SLOT.maxStepsN] = (opts.maxSteps * renderScale) / 192;
  slot0[FZ_SLOT.detail] = opts.detail / renderScale;
  slot0[FZ_SLOT.ao] = opts.ao;
  slot0[FZ_SLOT.shadow] = opts.shadow;
  slot0[FZ_SLOT.glow] = opts.glow;
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
  slot0[FZ_SLOT.mark] = 1;

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
