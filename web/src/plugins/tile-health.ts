/**
 * Empty-tile detection and automatic healing (host-only).
 *
 * Sampling, classification, heal ladder, and backoff are pure / testable here.
 * DOM and NetScene wiring live in {@link TileHealthMonitor}.
 */

import type { Viewport } from "../graph/render-host";

export const TILE_CHECK_MS = 2000;
export const TILE_EMPTY_STREAK = 3;
export const TILE_HEAL_OK_STREAK = 3;
export const TILE_PATCH = 16;
/** Luminance max−min (0–255) below this ⇒ near-uniform. */
export const TILE_UNIFORM_SPREAD = 6;
/** Luminance std-dev below this ⇒ near-uniform. */
export const TILE_UNIFORM_STDDEV = 4;
export const TILE_HEAL_PIN_WINDOW_MS = 10 * 60 * 1000;
export const TILE_HEAL_PIN_COUNT = 3;
export const TILE_HEAL_BACKOFF_BASE_MS = 2000;
export const TILE_HEAL_FALLBACK_MODE = "plugin:topology";

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
  patch: Uint8ClampedArray;
  signals: TileHealthSignals;
  lastCheckPictureSerial: number;
}

/** True when this 2 s check should count as EMPTY. */
export function classifyTileEmpty(input: TileEmptyInput): EmptyReason | null {
  if (input.signals.contextLost) return "context-lost";
  if (patchIsNearUniform(input.patch)) return "uniform";
  if (input.signals.drawingNothing && input.signals.dataFramesArriving) return "drawing-nothing";
  if (!input.signals.mayBeStatic
    && input.signals.pictureSerial === input.lastCheckPictureSerial) {
    return "stalled";
  }
  return null;
}

export function patchIsNearUniform(
  data: Uint8ClampedArray,
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

/** Reused 16×16 scratch (no per-check allocation). */
export class TilePatchSampler {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly buf: Uint8ClampedArray;

  constructor(size = TILE_PATCH) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.buf = new Uint8ClampedArray(size * size * 4);
  }

  private ensureCtx(): CanvasRenderingContext2D | null {
    if (!this.ctx) {
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    return this.ctx;
  }

  get scratchBuffer(): Uint8ClampedArray {
    return this.buf;
  }

  sample2d(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): Uint8ClampedArray {
    const ctx = this.ensureCtx();
    const s = this.canvas.width;
    if (!ctx) return this.buf;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, s, s);
    this.buf.set(ctx.getImageData(0, 0, s, s).data);
    return this.buf;
  }

  sampleGl(gl: WebGL2RenderingContext, x: number, y: number): Uint8ClampedArray {
    const s = this.canvas.width;
    gl.readPixels(x, y, s, s, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
    return this.buf;
  }
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

  const idx = Math.min(next.ladderIndex, HEAL_LADDER.length - 1);
  const step = HEAL_LADDER[idx]!;
  next.ladderIndex = Math.min(next.ladderIndex + 1, HEAL_LADDER.length - 1);
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

function recordHeal(state: PerTileHealthState, now: number): void {
  state.healTimes.push(now);
  const cutoff = now - TILE_HEAL_PIN_WINDOW_MS;
  state.healTimes = state.healTimes.filter((t) => t >= cutoff);
  if (state.healTimes.length >= TILE_HEAL_PIN_COUNT) state.pinnedFallback = true;
}

/** Centre of a host viewport for readPixels (origin bottom-left). */
export function patchOrigin(vp: Viewport, patch = TILE_PATCH): { x: number; y: number } {
  const x = Math.max(0, Math.min(vp.w - patch, Math.floor(vp.x + (vp.w - patch) / 2)));
  const y = Math.max(0, Math.min(vp.h - patch, Math.floor(vp.y + (vp.h - patch) / 2)));
  return { x, y };
}
