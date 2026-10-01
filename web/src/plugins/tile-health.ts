/**
 * Empty-tile detection and automatic healing (host-only).
 *
 * Sampling, classification, heal ladder, and backoff are pure / testable here.
 * DOM and NetScene wiring live in {@link TileHealthMonitor}.
 */

import type { Viewport } from "../graph/render-host";
import type { SourceLive } from "../core/sources";

export const TILE_CHECK_MS = 2000;
/** After load, view change, or source change — empty checks reset and do not count. */
export const TILE_LOAD_GRACE_MS = 5000;
export const TILE_EMPTY_STREAK = 3;
export const TILE_HEAL_OK_STREAK = 3;
export const TILE_PATCH = 16;
/** Health samples: the centre plus the centre of each quadrant. */
export const TILE_HEALTH_PATCHES = 5;
/** Luminance max−min (0–255) below this ⇒ near-uniform. */
export const TILE_UNIFORM_SPREAD = 6;
/** Luminance std-dev below this ⇒ near-uniform. */
export const TILE_UNIFORM_STDDEV = 4;
/**
 * #180 confirm: side of the coarse read of the tile's sky alone (no floor, graph or labels),
 * covering the whole tile. Five 16 px patches can all land on one dark area of a working pack
 * (nixie-clock's wood between the tubes); a uniform verdict only stands if this read is flat too.
 */
export const TILE_SKY_CONFIRM_PX = 64;
export const TILE_HEAL_PIN_WINDOW_MS = 10 * 60 * 1000;
export const TILE_HEAL_PIN_COUNT = 3;
export const TILE_HEAL_BACKOFF_BASE_MS = 2000;
export const TILE_HEAL_FALLBACK_MODE = "plugin:topology";

/** 16×16 RGBA sample (WebGL PBO and 2D canvas paths both use Uint8Array). */
export type TilePatchBytes = Uint8Array;

export type HealStep =
  | "resend-frame"
  | "restart-pack"
  | "recreate-context"
  | "demo-snapshot"
  | "fallback-pack";

export const HEAL_LADDER: readonly HealStep[] = [
  "resend-frame",
  "restart-pack",
  "recreate-context",
  "demo-snapshot",
  "fallback-pack",
];

export type EmptyReason = "uniform" | "stalled" | "context-lost" | "drawing-nothing";

export interface TileHealthSignals {
  mayBeStatic: boolean;
  contextLost: boolean;
  /** Monotonic serial bumped when this pane's picture changes. */
  pictureSerial: number;
  /** Viz / monitor frames are being delivered with live slices. */
  dataFramesArriving: boolean;
  /** Pack explicitly reported not drawing, or host inferred no viz writes. */
  drawingNothing: boolean;
}

export interface TileEmptyInput {
  patch: TilePatchBytes;
  signals: TileHealthSignals;
  lastCheckPictureSerial: number;
  /**
   * #180: the whole-tile sky read ({@link skyReadIsFlat}) when the five patches read uniform.
   * `false` overrules the patches (the sky shows something elsewhere); undefined keeps their verdict.
   */
  skyFlat?: boolean;
}

/**
 * #230: the tile's feeds are paused on purpose (`live.paused`): its bound source is paused, or, with
 * no bound source, every source is. Its picture may then hold still; that is not a stall.
 */
export function tileFeedsPaused(sources: Record<string, SourceLive> | undefined, bindSource?: string): boolean {
  const all = Object.values(sources ?? {});
  if (bindSource) return all.some((s) => s.id === bindSource && s.paused === true);
  return all.length > 0 && all.every((s) => s.paused === true);
}

/**
 * #227: the tile's view state is cant-draw (its own shader failed, or the shared context is lost).
 * Like couldn't-start, the tile already says why it is empty; health checks skip it until the
 * state clears (its shader compiles, its pack is swapped or updated, or the context is back).
 */
export function tileCantDraw(state: { kind: string } | null | undefined): boolean {
  return state?.kind === "cant-draw";
}

/** True when this 2 s check should count as EMPTY. */
export function classifyTileEmpty(input: TileEmptyInput): EmptyReason | null {
  if (input.signals.contextLost) return "context-lost";
  if (patchesAreNearUniform(input.patch) && input.skyFlat !== false) return "uniform";
  if (input.signals.drawingNothing && input.signals.dataFramesArriving) return "drawing-nothing";
  if (!input.signals.mayBeStatic
    && input.signals.pictureSerial === input.lastCheckPictureSerial) {
    return "stalled";
  }
  return null;
}

export function patchIsNearUniform(
  data: TilePatchBytes,
  spreadThreshold = TILE_UNIFORM_SPREAD,
  stdThreshold = TILE_UNIFORM_STDDEV,
): boolean {
  const n = (data.length / 4) | 0;
  if (n < 4) return true;
  let sum = 0;
  let sumSq = 0;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    sum += lum;
    sumSq += lum * lum;
    if (lum < lo) lo = lum;
    if (lum > hi) hi = lum;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const std = Math.sqrt(variance);
  return (hi - lo) < spreadThreshold || std < stdThreshold;
}

/**
 * #180 confirm: the coarse whole-tile sky read is flat only when every sample's luminance is within
 * {@link TILE_UNIFORM_SPREAD} of every other. No std-dev escape: a dark sky with a few small lit
 * features (tubes, stars) is a working pack, not a blank tile.
 */
export function skyReadIsFlat(data: TilePatchBytes): boolean {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    if (lum < lo) lo = lum;
    if (lum > hi) hi = lum;
  }
  return hi - lo < TILE_UNIFORM_SPREAD;
}

/** Reused 16×16 scratch (no per-check allocation). */
/**
 * Multi-patch read (centre + four quadrants, {@link TILE_HEALTH_PATCHES} × N×N RGBA back to back).
 * Uniform only when every patch is near-uniform AND the patches match each other: a flat pond
 * centre with fish at the edges is a working pack, not a blank tile. A single-patch buffer falls
 * back to {@link patchIsNearUniform}.
 */
export function patchesAreNearUniform(data: TilePatchBytes, size = TILE_PATCH): boolean {
  const chunk = size * size * 4;
  if (data.length < chunk * 2) return patchIsNearUniform(data);
  let lo = 255;
  let hi = 0;
  for (let off = 0; off + chunk <= data.length; off += chunk) {
    const part = data.subarray(off, off + chunk);
    if (!patchIsNearUniform(part)) return false;
    const m = patchMeanLuma(part);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return hi - lo < TILE_UNIFORM_SPREAD;
}

function patchMeanLuma(data: TilePatchBytes): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Top-left (or bottom-left in framebuffer space; the layout is symmetric) of the five health
 * patches inside `vp`: centre, then the centre of each quadrant. Clamped inside the viewport.
 */
export function healthPatchOrigins(
  vp: { x: number; y: number; w: number; h: number },
  size = TILE_PATCH,
): { x: number; y: number }[] {
  const at = (fx: number, fy: number) => ({
    x: Math.floor(Math.max(vp.x, Math.min(vp.x + vp.w - size, vp.x + vp.w * fx - size / 2))),
    y: Math.floor(Math.max(vp.y, Math.min(vp.y + vp.h - size, vp.y + vp.h * fy - size / 2))),
  });
  return [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
}

export class TilePatchSampler {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly buf: TilePatchBytes;

  constructor(size = TILE_PATCH) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.buf = new Uint8Array(size * size * 4);
  }

  private ensureCtx(): CanvasRenderingContext2D | null {
    if (!this.ctx) {
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    return this.ctx;
  }

  get scratchBuffer(): TilePatchBytes {
    return this.buf;
  }

  sample2d(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): TilePatchBytes {
    const ctx = this.ensureCtx();
    const s = this.canvas.width;
    if (!ctx) return this.buf;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, s, s);
    this.buf.set(ctx.getImageData(0, 0, s, s).data);
    return this.buf;
  }

  /** Software path: the five health patches back to back (see {@link patchesAreNearUniform}). */
  sampleMulti2d(source: CanvasImageSource, origins: { x: number; y: number }[], sw: number): TilePatchBytes {
    const s = this.canvas.width;
    const chunk = s * s * 4;
    if (!this.multi || this.multi.length !== chunk * origins.length) {
      this.multi = new Uint8Array(chunk * origins.length);
    }
    const ctx = this.ensureCtx();
    if (!ctx) return this.multi;
    origins.forEach((o, i) => {
      ctx.clearRect(0, 0, s, s);
      ctx.drawImage(source, o.x, o.y, sw, sw, 0, 0, s, s);
      this.multi!.set(ctx.getImageData(0, 0, s, s).data, i * chunk);
    });
    return this.multi;
  }

  private multi: TilePatchBytes | null = null;
}

export function healMessage(reason: EmptyReason, step: HealStep, emptyMs: number): string {
  const secs = Math.round(emptyMs / 1000);
  const verb: Record<HealStep, string> = {
    "resend-frame": "re-sent frame",
    "restart-pack": "restarted pack",
    "recreate-context": "recreated graphics context",
    "demo-snapshot": "switched to demo snapshot",
    "fallback-pack": "switched to fallback pack",
  };
  const why: Record<EmptyReason, string> = {
    uniform: "blank",
    stalled: "stalled",
    "context-lost": "WebGL context lost",
    "drawing-nothing": "pack not drawing",
  };
  return `Tile ${why[reason]} for ${secs} s, ${verb[step]}`;
}

export interface TileHealLogEntry {
  tileId: string;
  packId: string;
  step: HealStep;
  reason: EmptyReason;
}

export interface PerTileHealthState {
  emptyStreak: number;
  healthyStreak: number;
  ladderIndex: number;
  backoffUntil: number;
  healAttempts: number;
  healTimes: number[];
  pinnedFallback: boolean;
  forceDemo: boolean;
  lastCheckPictureSerial: number;
  emptySince: number;
  lastReason: EmptyReason | null;
  lastMessage: string;
}

export function freshTileHealthState(): PerTileHealthState {
  return {
    emptyStreak: 0,
    healthyStreak: 0,
    ladderIndex: 0,
    backoffUntil: 0,
    healAttempts: 0,
    healTimes: [],
    pinnedFallback: false,
    forceDemo: false,
    lastCheckPictureSerial: -1,
    emptySince: 0,
    lastReason: null,
    lastMessage: "",
  };
}

/**
 * Clear empty-detection progress and cancel a pending heal (backoff / streak).
 * Keeps pin, ladder index, and heal history from completed heals.
 */
export function resetTileHealthProgress(state: PerTileHealthState): PerTileHealthState {
  return {
    ...state,
    emptyStreak: 0,
    healthyStreak: 0,
    emptySince: 0,
    lastReason: null,
    backoffUntil: 0,
    lastCheckPictureSerial: -1,
    lastMessage: "",
  };
}

export interface TileCheckOutcome {
  state: PerTileHealthState;
  empty: EmptyReason | null;
  heal: HealStep | null;
  log: TileHealLogEntry | null;
}

/**
 * Apply one staggered health check. Mutates `state` and returns whether a heal
 * step should run now.
 */
export function stepTileHealth(
  state: PerTileHealthState,
  now: number,
  input: TileEmptyInput,
  tileId: string,
  packId: string,
): TileCheckOutcome {
  const reason = classifyTileEmpty(input);
  const next = { ...state, healTimes: [...state.healTimes] };
  next.lastCheckPictureSerial = input.signals.pictureSerial;

  if (!reason) {
    next.emptyStreak = 0;
    next.emptySince = 0;
    next.lastReason = null;
    next.healthyStreak++;
    if (next.healthyStreak >= TILE_HEAL_OK_STREAK) {
      next.ladderIndex = 0;
      next.healAttempts = 0;
      next.backoffUntil = 0;
      next.forceDemo = false;
      next.healthyStreak = 0;
    }
    return { state: next, empty: null, heal: null, log: null };
  }

  next.healthyStreak = 0;
  next.emptyStreak++;
  if (next.emptyStreak === 1) next.emptySince = now;
  next.lastReason = reason;

  if (next.emptyStreak < TILE_EMPTY_STREAK) {
    return { state: next, empty: reason, heal: null, log: null };
  }

  if (now < next.backoffUntil) {
    return { state: next, empty: reason, heal: null, log: null };
  }

  if (next.pinnedFallback) {
    return { state: next, empty: reason, heal: null, log: null };
  }

  const healsInWindow = healTimesInWindow(next.healTimes, now);
  const forceFallback = healsInWindow >= TILE_HEAL_PIN_COUNT - 1;
  const idx = Math.min(next.ladderIndex, HEAL_LADDER.length - 1);
  const step = forceFallback ? "fallback-pack" : HEAL_LADDER[idx]!;
  if (!forceFallback) {
    next.ladderIndex = Math.min(next.ladderIndex + 1, HEAL_LADDER.length - 1);
  } else {
    next.ladderIndex = HEAL_LADDER.length - 1;
  }
  next.healAttempts++;
  next.backoffUntil = now + TILE_HEAL_BACKOFF_BASE_MS * (2 ** Math.min(6, next.healAttempts - 1));
  if (step === "demo-snapshot") next.forceDemo = true;
  if (step === "fallback-pack") next.pinnedFallback = true;
  next.emptyStreak = 0;
  next.healthyStreak = 0;
  next.lastMessage = healMessage(reason, step, now - next.emptySince);
  const log = { tileId, packId, step, reason };
  recordHeal(next, now);
  return { state: next, empty: reason, heal: step, log };
}

function healTimesInWindow(healTimes: number[], now: number): number {
  const cutoff = now - TILE_HEAL_PIN_WINDOW_MS;
  return healTimes.filter((t) => t >= cutoff).length;
}

function recordHeal(state: PerTileHealthState, now: number): void {
  state.healTimes.push(now);
  const cutoff = now - TILE_HEAL_PIN_WINDOW_MS;
  state.healTimes = state.healTimes.filter((t) => t >= cutoff);
}

/** Centre of a host viewport for readPixels (origin bottom-left). */
export function patchOrigin(vp: Viewport, patch = TILE_PATCH): { x: number; y: number } {
  const x = Math.max(vp.x, Math.min(vp.x + vp.w - patch, Math.floor(vp.x + (vp.w - patch) / 2)));
  const y = Math.max(vp.y, Math.min(vp.y + vp.h - patch, Math.floor(vp.y + (vp.h - patch) / 2)));
  return { x, y };
}

/** When true, an empty check was skipped (async read pending) — must not advance the empty streak. */
export function isSkippedHealthSample(patch: TilePatchBytes | null | undefined): boolean {
  return patch == null;
}
