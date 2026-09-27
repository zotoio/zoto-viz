/**
 * Rocket Car Soccer — view options, caps, buffer layout shared with the sky shader.
 */

export const RCS_CAPS = {
  maxCars: 8,
  maxTeam: 4,
  maxParticles: 96,
  maxTrailSegments: 48,
  maxPhysicsSubsteps: 6,
} as const;

export const RCS_MAX_CARS = RCS_CAPS.maxCars;
export const RCS_MAX_TEAM = RCS_CAPS.maxTeam;
export const RCS_MAX_PARTICLES = RCS_CAPS.maxParticles;
export const RCS_MAX_TRAIL_SEGMENTS = RCS_CAPS.maxTrailSegments;
export const RCS_MAX_SUBSTEPS = RCS_CAPS.maxPhysicsSubsteps;
export const RCS_FIXED_HZ = 120;
export const RCS_FIXED_DT = 1 / RCS_FIXED_HZ;
/** Horizontal speed cap for boost cars (m/s in sim units). */
export const RCS_MAX_CAR_SPEED = 42;
export const RCS_GOAL_CELEBRATION_COOLDOWN_SEC = 3;
export const RCS_TALKER_SLOT_HOLD_SEC = 2;
export const RCS_CHALLENGER_RATE_MARGIN = 1.2;
export const RCS_MIN_DIRECTOR_CUT_SEC = 4;
export const RCS_SLOT0_FLOATS = 64;
export const RCS_SLOT1_FLOATS = 64;
export const RCS_SLOT2_FLOATS = 64;

/** Slot 0 layout (must match sky/fragment.glsl). */
export const RCS_SLOT = {
  mark: 0,
  camX: 1,
  camY: 2,
  camZ: 3,
  camYaw: 4,
  camPitch: 5,
  camRoll: 6,
  camFov: 7,
  clock: 8,
  scoreOrange: 9,
  scoreBlue: 10,
  phase: 11,
  slowMo: 12,
  goalFlash: 13,
  aspect: 14,
  theme: 15,
  particlePct: 16,
  cutBlend: 17,
  camMode: 18,
  trailStyle: 19,
  explodeStyle: 20,
  replay: 21,
  matchLen: 22,
  ballScale: 23,
  gameSpeed: 24,
  aggress: 25,
  shake: 26,
  carCount: 27,
  failAlert: 28,
  demoFlag: 29,
  flowMetric: 30,
  presetCode: 31,
  hudSeed: 32,
  modelFlags: 33,
} as const;

export const RCS_BALL_BASE = 0;
export const RCS_CAR0 = 6;
export const RCS_CAR_STRIDE = 9;

export type RcsTheme = "day" | "night" | "neon";
export type RcsCamera = "broadcast" | "ballcam" | "director" | "orbit";
export type RcsTrail = "soft" | "sharp" | "spark";
export type RcsExplode = "confetti" | "shockwave" | "embers";
export type RcsPresetId = "broadcast" | "neon_night" | "chaos_3v3" | "chill_orbit";

export interface RcsOptions {
  preset: RcsPresetId;
  teamSize: number;
  seed: number;
  teamOrange: string;
  teamBlue: string;
  theme: RcsTheme;
  aggress: number;
  gameSpeed: number;
  trail: RcsTrail;
  camera: RcsCamera;
  minCutSec: number;
  explode: RcsExplode;
  replay: boolean;
  matchSec: number;
  ballSize: number;
  particles: number;
  reducedMotion: boolean;
}

export const RCS_DEFAULTS: RcsOptions = {
  preset: "broadcast",
  teamSize: 3,
  seed: 42,
  teamOrange: "#ff8c32",
  teamBlue: "#3aa7ff",
  theme: "day",
  aggress: 55,
  gameSpeed: 100,
  trail: "soft",
  camera: "ballcam",
  minCutSec: 4,
  explode: "shockwave",
  replay: true,
  matchSec: 300,
  ballSize: 100,
  particles: 70,
  reducedMotion: false,
};

export const RCS_PRESETS: Record<RcsPresetId, Partial<RcsOptions>> = {
  broadcast: {
    teamSize: 3,
    theme: "day",
    camera: "broadcast",
    minCutSec: 4.5,
    gameSpeed: 100,
    aggress: 50,
    trail: "soft",
    explode: "shockwave",
    replay: true,
    particles: 60,
  },
  neon_night: {
    teamSize: 3,
    theme: "neon",
    camera: "director",
    minCutSec: 4,
    gameSpeed: 110,
    aggress: 65,
    trail: "spark",
    explode: "confetti",
    replay: true,
    particles: 85,
  },
  chaos_3v3: {
    teamSize: 3,
    theme: "neon",
    camera: "director",
    minCutSec: 3.5,
    gameSpeed: 140,
    aggress: 95,
    trail: "sharp",
    explode: "shockwave",
    replay: true,
    particles: 100,
  },
  chill_orbit: {
    teamSize: 2,
    theme: "night",
    camera: "orbit",
    minCutSec: 6,
    gameSpeed: 75,
    aggress: 35,
    trail: "soft",
    explode: "embers",
    replay: false,
    particles: 45,
  },
};

const PRESET_KEYS = new Set(Object.keys(RCS_PRESETS));

function rcsBannedTerms(): readonly string[] {
  return [
    String.fromCharCode(0x72, 0x6f, 0x63, 0x6b, 0x65, 0x74, 0x20, 0x6c, 0x65, 0x61, 0x67, 0x75, 0x65),
    String.fromCharCode(0x70, 0x73, 0x79, 0x6f, 0x6e, 0x69, 0x78),
    String.fromCharCode(0x6d, 0x69, 0x6e, 0x65, 0x63, 0x72, 0x61, 0x66, 0x74),
    String.fromCharCode(0x6d, 0x6f, 0x6a, 0x61, 0x6e, 0x67),
  ];
}

export function scanRcsTrademarks(text: string): string | null {
  const lower = text.toLowerCase();
  for (const mark of rcsBannedTerms()) {
    if (lower.includes(mark)) return mark;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function num(raw: string | undefined, def: number, lo: number, hi: number, scale = 1): number {
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) ? clamp(v * scale, lo, hi) : def;
}

function bool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw === "") return def;
  return raw === "true" || raw === "1" || raw === "on";
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return def;
}

function hexNorm(raw: string | undefined, def: string): string {
  const s = (raw ?? def).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return def;
}

/** Defaults from visualisation.yml the host sends for untouched This-view fields. */
const RCS_VIZ_FORM_DEFAULTS: Record<string, string> = {
  preset: "broadcast",
  seed: "42",
  teamSize: "3",
  teamOrange: "#ff8c32",
  teamBlue: "#3aa7ff",
  theme: "day",
  aggress: "55",
  gameSpeed: "100",
  trail: "soft",
  camera: "ballcam",
  minCutSec: "4",
  explode: "shockwave",
  replay: "true",
  matchSec: "300",
  ballSize: "100",
  particles: "70",
  reducedMotion: "false",
};

function hostStillOnFormDefault(key: string, raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return true;
  const def = RCS_VIZ_FORM_DEFAULTS[key];
  return def !== undefined && raw.trim() === def;
}

export function parseRcsOptions(o: Record<string, string | undefined> = {}): RcsOptions {
  let base = { ...RCS_DEFAULTS };
  const presetRaw = o.preset?.trim();
  const preset = presetRaw && PRESET_KEYS.has(presetRaw) ? (presetRaw as RcsPresetId) : base.preset;
  if (PRESET_KEYS.has(preset)) {
    base = { ...base, ...RCS_PRESETS[preset], preset };
  }
  return {
    preset,
    teamSize: hostStillOnFormDefault("teamSize", o.teamSize)
      ? base.teamSize
      : Math.round(num(o.teamSize, base.teamSize, 2, RCS_MAX_TEAM)),
    seed: hostStillOnFormDefault("seed", o.seed)
      ? base.seed
      : Math.round(num(o.seed, base.seed, 1, 999999)),
    teamOrange: hostStillOnFormDefault("teamOrange", o.teamOrange)
      ? base.teamOrange
      : hexNorm(o.teamOrange, base.teamOrange),
    teamBlue: hostStillOnFormDefault("teamBlue", o.teamBlue)
      ? base.teamBlue
      : hexNorm(o.teamBlue, base.teamBlue),
    theme: hostStillOnFormDefault("theme", o.theme) ? base.theme : pick(o.theme, ["day", "night", "neon"] as const, base.theme),
    aggress: hostStillOnFormDefault("aggress", o.aggress) ? base.aggress : num(o.aggress, base.aggress, 0, 100),
    gameSpeed: hostStillOnFormDefault("gameSpeed", o.gameSpeed)
      ? base.gameSpeed
      : num(o.gameSpeed, base.gameSpeed, 25, 200),
    trail: hostStillOnFormDefault("trail", o.trail) ? base.trail : pick(o.trail, ["soft", "sharp", "spark"] as const, base.trail),
    camera: hostStillOnFormDefault("camera", o.camera)
      ? base.camera
      : pick(o.camera, ["broadcast", "ballcam", "director", "orbit"] as const, base.camera),
    minCutSec: hostStillOnFormDefault("minCutSec", o.minCutSec)
      ? base.minCutSec
      : num(o.minCutSec, base.minCutSec, RCS_MIN_DIRECTOR_CUT_SEC, 12),
    explode: hostStillOnFormDefault("explode", o.explode)
      ? base.explode
      : pick(o.explode, ["confetti", "shockwave", "embers"] as const, base.explode),
    replay: hostStillOnFormDefault("replay", o.replay) ? base.replay : bool(o.replay, base.replay),
    matchSec: hostStillOnFormDefault("matchSec", o.matchSec)
      ? base.matchSec
      : Math.round(num(o.matchSec, base.matchSec, 60, 900)),
    ballSize: hostStillOnFormDefault("ballSize", o.ballSize) ? base.ballSize : num(o.ballSize, base.ballSize, 70, 140),
    particles: hostStillOnFormDefault("particles", o.particles)
      ? base.particles
      : Math.round(num(o.particles, base.particles, 0, 100)),
    reducedMotion: hostStillOnFormDefault("reducedMotion", o.reducedMotion)
      ? base.reducedMotion
      : bool(o.reducedMotion, base.reducedMotion),
  };
}

export function validatePreset(id: string): id is RcsPresetId {
  return PRESET_KEYS.has(id);
}

export function presetConfigValues(id: RcsPresetId): Record<string, string> {
  const p = RCS_PRESETS[id];
  return {
    preset: id,
    seed: String(RCS_DEFAULTS.seed),
    teamSize: String(p.teamSize ?? RCS_DEFAULTS.teamSize),
    theme: String(p.theme ?? RCS_DEFAULTS.theme),
    camera: String(p.camera ?? RCS_DEFAULTS.camera),
    minCutSec: String(p.minCutSec ?? RCS_DEFAULTS.minCutSec),
    gameSpeed: String(p.gameSpeed ?? RCS_DEFAULTS.gameSpeed),
    aggress: String(p.aggress ?? RCS_DEFAULTS.aggress),
    trail: String(p.trail ?? RCS_DEFAULTS.trail),
    explode: String(p.explode ?? RCS_DEFAULTS.explode),
    replay: p.replay ? "true" : "false",
    particles: String(p.particles ?? RCS_DEFAULTS.particles),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function themeBgAccent(theme: RcsTheme): { bg: [number, number, number]; accent: [number, number, number] } {
  if (theme === "neon") return { bg: [0.04, 0.02, 0.08], accent: [0.9, 0.2, 1.0] };
  if (theme === "night") return { bg: [0.03, 0.05, 0.09], accent: [0.35, 0.75, 1.0] };
  return { bg: [0.08, 0.12, 0.18], accent: [0.95, 0.72, 0.35] };
}

export function packThemeCode(theme: RcsTheme): number {
  return theme === "neon" ? 2 : theme === "night" ? 1 : 0;
}

export function packCameraCode(cam: RcsCamera): number {
  return cam === "ballcam" ? 1 : cam === "director" ? 2 : cam === "orbit" ? 3 : 0;
}

export function packTrailCode(t: RcsTrail): number {
  return t === "sharp" ? 1 : t === "spark" ? 2 : 0;
}

export function packExplodeCode(e: RcsExplode): number {
  return e === "confetti" ? 1 : e === "embers" ? 2 : 0;
}

/** Host render-scale governor hook — fixed 1.0 until the shared governor lands. */
export function rcsRenderScale(): number {
  return 1.0;
}

