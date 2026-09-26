/**
 * What the stereogram sky reads from buffer slot 0 (32 floats):
 * [traffic activity 0–1, talkers 0–1, seconds per object, morph seconds,
 *  palette mode (0 with each object, 1 own timer), palette seconds,
 *  still seconds, motion seconds,
 *  repeat width (% of pane height), bands per repeat, band multiplier while moving,
 *  animation speed (fraction of the original pace),
 *  audio reactive (1 = spectrum), audio level 0–1, integrated animation clock,
 *  bin shape (0 oblong, 1 cubes, 2 balls, 3 bars that morph into balls),
 *  up to 6 spectrum bins low→high then pad to 8,
 *  AI scene header (on, parts, turn angle, lift, centre xyz, pad)].
 * Slots 1–7 hold the frame the host builds from all of this (see frame.ts).
 *
 * The clock is integrated here so a changing rate does not rewind `uTime`.
 * Audio reactive replaces the speed fraction with the pulse level.
 */

export const STEREO_BINS = 6;
const BIN_FLOATS = 8;
const HEAD_FLOATS = 8;

export const STEREO_HOLD = { def: 16, min: 4, max: 120 };
export const STEREO_MORPH = { def: 3, min: 0.5, max: 12 };
export const STEREO_PALETTE_SECONDS = { def: 30, min: 5, max: 600 };
export const STEREO_STILL = { def: 4, min: 0, max: 60 };
export const STEREO_MOVE = { def: 2, min: 0.5, max: 30 };
export const STEREO_REPEAT = { def: 8, min: 4, max: 16 };
export const STEREO_BANDS = { def: 14, min: 4, max: 40 };
export const STEREO_MOTION_BANDS = { def: 2, min: 1, max: 4 };
/** Percent of the original pace. 50 is half. */
export const STEREO_SPEED = { def: 50, min: 10, max: 200 };

/** Rack spacing presets. Gap and width are in pattern repeats. */
export const STEREO_RACKS = {
  a: { solids: 6, gap: 1.6, width: 1.1 },
  b: { solids: 6, gap: 2.2, width: 1 },
  c: { solids: 5, gap: 2.8, width: 1.1 },
  d: { solids: 4, gap: 4, width: 1.2 },
  e: { solids: 3, gap: 5.5, width: 1.3 },
} as const;
export const STEREO_RACK_DEFAULT = "c";
export type StereoRackPreset = keyof typeof STEREO_RACKS | "custom";

export const STEREO_SOLIDS = { def: 5, min: 3, max: 6 };
export const STEREO_GAP = { def: 2.8, min: 0.3, max: 6 };
export const STEREO_WIDTH = { def: 1.1, min: 0.5, max: 2.5 };
/** Percent of its resting width a solid gains at full level. */
export const STEREO_GROWTH = { def: 100, min: 0, max: 200 };
/** Object depth, percent of the way from the far wall toward the eye. */
export const STEREO_DEPTH = { def: 40, min: 0, max: 100 };
/** Distance between objects, percent of the usual gap. */
export const STEREO_SPACING = { def: 100, min: 50, max: 200 };
/** Where a solid grows from: percent of its resting width left of centre. */
export const STEREO_ORIGIN = { def: 25, min: -100, max: 100 };
/** Meter ballistics in milliseconds: quick rise, slower fall. */
export const STEREO_RISE_MS = { def: 150, min: 20, max: 600 };
export const STEREO_FALL_MS = { def: 500, min: 50, max: 2000 };

export interface StereoRack {
  preset: StereoRackPreset;
  solids: number;
  /** Space between resting solids, in pattern repeats. */
  gap: number;
  /** Resting width, in pattern repeats. */
  width: number;
  /** Fraction of the resting width gained at full level. */
  growth: number;
  /** Resting depth 0–1. */
  depth: number;
  /** Where a swelling solid grows from, as a fraction of its resting width left of centre (negative is right). */
  origin: number;
  /** A louder ball stretches right into a pill (steady), or swells wider (slides the pattern under it). */
  ballGrow: "stretch" | "swell";
  /** Meter rise and fall, seconds. */
  rise: number;
  fall: number;
}

export interface StereoTiming {
  hold: number;
  morph: number;
  palette: "objects" | "timer";
  paletteSeconds: number;
  still: number;
  move: number;
  repeat: number;
  bands: number;
  motionBands: number;
  /** Fraction of the original pace, used while audio reactive is off. */
  speed: number;
  /** Spectrum scene; pace follows the pulse instead of `speed`. */
  audio: boolean;
  /** Same solid for every bin. Only size and position follow that bin. */
  shape: "morph" | "oblong" | "cubes" | "balls";
  /** Local-model scenes while the header AI switch is on. */
  ai: boolean;
  /** Distance between objects, as a fraction of the usual gap. 1 keeps the authored layout. */
  spacing: number;
  rack: StereoRack;
}

export interface StereoLive {
  clock?: number;
  level?: number;
  bins?: number[];
  /** AI scene header; absent or short leaves the scene off. */
  scene?: number[];
}

function num(raw: string | undefined, lim: { def: number; min: number; max: number }): number {
  const v = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : lim.def;
}

function parseRack(cfg?: Record<string, string>): StereoRack {
  const raw = cfg?.rack ?? "";
  const preset: StereoRackPreset = raw === "custom" || raw in STEREO_RACKS ? raw as StereoRackPreset : STEREO_RACK_DEFAULT;
  const spacing = preset === "custom"
    ? {
      solids: Math.round(num(cfg?.solids, STEREO_SOLIDS)),
      gap: num(cfg?.gap, STEREO_GAP),
      width: num(cfg?.width, STEREO_WIDTH),
    }
    : STEREO_RACKS[preset];
  return {
    preset,
    ...spacing,
    growth: num(cfg?.growth, STEREO_GROWTH) / 100,
    depth: num(cfg?.depth, STEREO_DEPTH) / 100,
    origin: num(cfg?.origin, STEREO_ORIGIN) / 100,
    ballGrow: cfg?.ballGrow === "swell" ? "swell" : "stretch",
    rise: num(cfg?.rise, STEREO_RISE_MS) / 1000,
    fall: num(cfg?.fall, STEREO_FALL_MS) / 1000,
  };
}

export function parseStereoTiming(cfg?: Record<string, string>): StereoTiming {
  return {
    hold: num(cfg?.hold, STEREO_HOLD),
    morph: num(cfg?.morph, STEREO_MORPH),
    palette: cfg?.palette === "timer" ? "timer" : "objects",
    paletteSeconds: num(cfg?.paletteSeconds, STEREO_PALETTE_SECONDS),
    still: num(cfg?.still, STEREO_STILL),
    move: num(cfg?.move, STEREO_MOVE),
    repeat: num(cfg?.repeat, STEREO_REPEAT),
    bands: Math.round(num(cfg?.bands, STEREO_BANDS)),
    motionBands: num(cfg?.motionBands, STEREO_MOTION_BANDS),
    speed: num(cfg?.speed, STEREO_SPEED) / 100,
    audio: cfg?.audio !== "0" && cfg?.audio !== "false",
    shape: cfg?.shape === "oblong" || cfg?.shape === "cubes" || cfg?.shape === "balls" ? cfg.shape : "morph",
    ai: cfg?.ai !== "0" && cfg?.ai !== "false",
    spacing: num(cfg?.spacing, STEREO_SPACING) / 100,
    rack: parseRack(cfg),
  };
}

function shapeCode(shape: StereoTiming["shape"]): number {
  if (shape === "morph") return 3;
  if (shape === "balls") return 2;
  if (shape === "cubes") return 1;
  return 0;
}

/** Ease bins toward the heard spectrum so a solid changes slowly enough for the eyes to keep it fused. */
export function easeStereoBins(
  prev: number[], next: number[], dt: number,
  rise = STEREO_RISE_MS.def / 1000, fall = STEREO_FALL_MS.def / 1000,
): number[] {
  const step = Math.max(0, dt);
  return next.map((v, i) => {
    const p = prev[i] ?? 0;
    return p + (v - p) * (1 - Math.exp(-step / Math.max(1e-3, v > p ? rise : fall)));
  });
}

/** Pace this frame: the pulse while audio reactive, otherwise the speed fraction. */
export function stereoRate(timing: StereoTiming, level: number): number {
  if (timing.audio) return Math.min(1, Math.max(0, level));
  return timing.speed;
}

let stereoClock = 0;
let stereoAt = 0;

export function resetStereoClock(): void {
  stereoClock = 0;
  stereoAt = 0;
}

export function stereoClockNow(): number {
  return stereoClock;
}

/** Advance the animation clock. The first call only stamps time, so a late start does not leap. */
export function stepStereoClock(now: number, rate: number): number {
  if (stereoAt > 0) {
    const dt = Math.min(0.1, Math.max(0, now - stereoAt));
    stereoClock += dt * Math.max(0, rate);
  }
  stereoAt = now;
  return stereoClock;
}

export function packStereoDrive(talkers: { rate: number }[], timing: StereoTiming, live: StereoLive = {}): number[] {
  let sum = 0;
  for (const t of talkers) sum += Math.max(0, t.rate);
  const bins = new Array<number>(BIN_FLOATS).fill(0);
  for (let i = 0; i < STEREO_BINS; i++) {
    const v = live.bins?.[i];
    bins[i] = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }
  const head = new Array<number>(HEAD_FLOATS).fill(0);
  if (live.scene && live.scene.length >= HEAD_FLOATS) {
    for (let i = 0; i < HEAD_FLOATS; i++) head[i] = Number.isFinite(live.scene[i]) ? live.scene[i]! : 0;
  }
  const level = typeof live.level === "number" && Number.isFinite(live.level)
    ? Math.min(1, Math.max(0, live.level))
    : 0;
  const clock = typeof live.clock === "number" && Number.isFinite(live.clock) ? live.clock : 0;
  return [
    1 - Math.exp(-sum / 150), Math.min(8, talkers.length) / 8, timing.hold, timing.morph,
    timing.palette === "timer" ? 1 : 0, timing.paletteSeconds, timing.still, timing.move,
    timing.repeat, timing.bands, timing.motionBands, timing.speed,
    timing.audio ? 1 : 0, level, clock, shapeCode(timing.shape),
    ...bins,
    ...head,
  ];
}
