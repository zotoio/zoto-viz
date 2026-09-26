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
 * Hard GPU ceilings (shader + drive min()). Conservative starting point — tune on a real GPU locally;
 * do not gate CI on cloud VM frame times.
 * TODO(VizFrameBudget): tie ceilings to host render-scale governor once it ships.
 */
export const FRACTAL_ITER_CEIL = 32;
export const FRACTAL_STEPS_CEIL = 48;
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

const PILOT_TARGETS = [
  [-0.745, 0.186],
  [-0.16, 1.0405],
  [-0.235, 0.827],
  [-0.8, 0.156],
  [-1.25, 0.045],
];

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

/** Per-iframe (or per mosaic tile) camera / zoom integrator — no shared module globals. */
export class FractalDriveRuntime {
  /** Test hook: one increment per drive() call. */
  advanceCount = 0;
  hudCaption = "Mandelbulb · Classic Dive";
  zoomLog = -0.35;

  private optsCache: FractalOptions = parseFractalOptions();
  private optsJson = "";
  private camX = 0.05;
  private camY = 0.02;
  private camZ = -0.85;
  private yaw = 0.55;
  private pitch = -0.08;
  private roll = 0;
  private pingPhase = 0;
  private morphT = 0;
  private pilotSeed = 0.37;
  private lastFrameMs = 0;

  setOptions(o: Record<string, string | undefined>): FractalOptions {
    const json = JSON.stringify(o);
    if (json !== this.optsJson) {
      this.optsJson = json;
      this.optsCache = parseFractalOptions(o);
      this.hudCaption = `${fractalTypeLabel(this.optsCache.type)} · ${fractalPresetLabel(this.optsCache.preset)}`;
    }
    return this.optsCache;
  }

  optionsNow(): FractalOptions {
    return this.optsCache;
  }

  resetCamera(): void {
    this.camX = 0.05;
    this.camY = 0.02;
    this.camZ = -0.85;
    this.zoomLog = -0.35;
    this.yaw = 0.55;
    this.pitch = -0.08;
    this.roll = 0;
    this.pingPhase = 0;
    this.morphT = 0;
    this.pilotSeed = 0.37;
  }

  reset(): void {
    this.resetCamera();
    this.optsJson = "";
    this.optsCache = parseFractalOptions();
    this.lastFrameMs = 0;
    this.advanceCount = 0;
    this.hudCaption = "Mandelbulb · Classic Dive";
  }

  getFrameMs(): number {
    return this.lastFrameMs;
  }

  drive(input: FractalDriveInput): FractalDriveOut {
    this.advanceCount += 1;
    const { t, dt, audio, aspect, opts, pointer } = input;
    this.lastFrameMs = dt * 1000;
    const renderScale = fractalRenderScale();

    if (opts.resetCam) this.resetCamera();

    let precisionClamp = 0;
    if (this.zoomLog > FRACTAL_ZOOM_LOG_LIMIT) {
      this.zoomLog = FRACTAL_ZOOM_LOG_LIMIT;
      precisionClamp = 1;
    }

    const audioDrv = opts.audioReactive ? audio : 0;
    const zoomSign = opts.zoomDir === "out" ? -1 : 1;
    this.pingPhase += dt * (opts.zoomDir === "pingpong" ? 0.45 : 0);
    const ping = opts.zoomDir === "pingpong" ? Math.sin(this.pingPhase) : zoomSign;

    const driftOnly = opts.reducedMotion && opts.autoPilot;
    const holdStill = opts.reducedMotion && opts.paused;

    if (!holdStill) {
      const zspd = opts.reducedMotion ? Math.min(opts.zoomSpeed, 0.12) : opts.zoomSpeed;
      if (!driftOnly) this.zoomLog += dt * zspd * ping * (0.65 + audioDrv * 0.5);
      this.morphT += dt * (opts.morph ? 0.35 + audioDrv * 0.2 : 0);
      if (!opts.reducedMotion) this.roll += dt * opts.rollSpeed * (0.5 + audioDrv);
      if (opts.autoPilot) {
        const drift = opts.reducedMotion ? 0.08 : 0.35;
        this.yaw += dt * opts.rotateSpeed * drift;
        const target = PILOT_TARGETS[Math.floor((t * 0.07 + this.pilotSeed) % PILOT_TARGETS.length)]!;
        this.camX += (target[0] * 0.35 - this.camX) * dt * 0.15;
        this.camY += (target[1] * 0.2 - this.camY) * dt * 0.12;
      }
    }

    if (!opts.autoPilot && !opts.reducedMotion) {
      this.yaw += dt * opts.rotateSpeed;
    }
    this.yaw += pointer.yaw;
    this.pitch = pointer.pitch;
    this.zoomLog += pointer.zoomWheel;
    pointer.yaw = 0;
    pointer.zoomWheel = 0;

    const [dirX, dirY, dirZ] = dirFromAngles(this.yaw, this.pitch, this.roll);
    const step = Math.exp(-this.zoomLog * 0.35);
    if (!holdStill && !driftOnly) {
      this.camX += dirX * step * dt * 0.4 * ping;
      this.camY += dirY * step * dt * 0.4 * ping;
      this.camZ += dirZ * step * dt * 0.4 * ping;
    }

    const power = opts.morph
      ? opts.power + Math.sin(this.morphT) * opts.morphAmount * 2
      : opts.power;

    const iter = Math.min(opts.maxIter, FRACTAL_ITER_CEIL);
    const steps = Math.min(opts.maxSteps, FRACTAL_STEPS_CEIL);

    const slot0 = new Array<number>(FZ_SLOT0_FLOATS).fill(0);
    slot0[FZ_SLOT.camX] = this.camX;
    slot0[FZ_SLOT.camY] = this.camY;
    slot0[FZ_SLOT.camZ] = this.camZ;
    slot0[FZ_SLOT.dirX] = dirX;
    slot0[FZ_SLOT.dirY] = dirY;
    slot0[FZ_SLOT.dirZ] = dirZ;
    slot0[FZ_SLOT.roll] = this.roll;
    slot0[FZ_SLOT.zoomLog] = this.zoomLog;
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
    slot0[FZ_SLOT.morphT] = this.morphT;
    slot0[FZ_SLOT.morphAmt] = opts.morphAmount;
    slot0[FZ_SLOT.renderScale] = renderScale;
    slot0[FZ_SLOT.juliaCr] = opts.juliaCr;
    slot0[FZ_SLOT.juliaCi] = opts.juliaCi;
    slot0[FZ_SLOT.quatC2] = opts.quatC2;
    slot0[FZ_SLOT.quatC3] = opts.quatC3;
    slot0[FZ_SLOT.audioDrv] = audioDrv;
    slot0[FZ_SLOT.pingPhase] = this.pingPhase;
    slot0[FZ_SLOT.kaleidoSym] = opts.kaleidoSym;
    slot0[FZ_SLOT.mandelCx] = opts.mandelCx;
    slot0[FZ_SLOT.mandelCy] = opts.mandelCy;
    slot0[FZ_SLOT.mandelScale] = Math.exp(-this.zoomLog * 0.08) * aspect;
    slot0[FZ_SLOT.frameMs] = this.lastFrameMs;
    slot0[FZ_SLOT.precisionClamp] = precisionClamp;
    slot0[FZ_SLOT.mark] = 1;

    this.hudCaption = `${fractalTypeLabel(opts.type)} · ${fractalPresetLabel(opts.preset)}`;
    if (precisionClamp) this.hudCaption += " · zoom limit";

    const bright = 1.05 + opts.glow * 0.45 + audioDrv * 0.3;
    const accent: [number, number, number] = [
      0.35 + opts.hueShift * 0.2,
      0.55 + opts.saturation * 0.2,
      0.95 - opts.hueShift * 0.15,
    ];

    return { slot0, bright, accent, bg: opts.bg };
  }

  packDrive(
    t: number,
    dt: number,
    audio: number,
    aspect: number,
    config: Record<string, string | undefined>,
    pointer: FractalPointerState,
  ): FractalDriveOut {
    const opts = this.setOptions(config);
    return this.drive({ t, dt, audio, aspect, opts, pointer });
  }
}

const defaultRuntime = new FractalDriveRuntime();

export let fractalHudCaption = defaultRuntime.hudCaption;

export function setFractalOptions(o: Record<string, string | undefined>): FractalOptions {
  const opts = defaultRuntime.setOptions(o);
  fractalHudCaption = defaultRuntime.hudCaption;
  return opts;
}

export function fractalOptionsNow(): FractalOptions {
  return defaultRuntime.optionsNow();
}

export function resetFractalCamera(): void {
  defaultRuntime.resetCamera();
}

export function resetFractalDrive(): void {
  defaultRuntime.reset();
  fractalHudCaption = defaultRuntime.hudCaption;
}

export function getFractalFrameMs(): number {
  return defaultRuntime.getFrameMs();
}

export function fractalDrive(input: FractalDriveInput): FractalDriveOut {
  const out = defaultRuntime.drive(input);
  fractalHudCaption = defaultRuntime.hudCaption;
  return out;
}

export function packFractalDrive(
  t: number,
  dt: number,
  audio: number,
  aspect: number,
  config: Record<string, string | undefined>,
  pointer: FractalPointerState,
): FractalDriveOut {
  const out = defaultRuntime.packDrive(t, dt, audio, aspect, config, pointer);
  fractalHudCaption = defaultRuntime.hudCaption;
  return out;
}

export function createFractalDriveRuntime(): FractalDriveRuntime {
  return new FractalDriveRuntime();
}
