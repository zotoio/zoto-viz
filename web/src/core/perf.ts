/**
 * Auto-tune: when the last 30 s average under 10 fps, ease expensive graph knobs down.
 * User settings stay put. Restore waits for a 1-minute recovered average (fresh after a
 * view change) and eases back over about a minute.
 */

import { windowFps } from "./fps";

export const PERF_FPS = 10;
export const PERF_HOLD_MS = 30_000;
export const PERF_RECOVER_MS = 60_000;
export const PERF_RECOVER_FPS = 16;
/** Time constant (seconds) easing into the lean mix. */
export const PERF_DROP_S = 1.8;
/** Restore glide at full moveEase (~1 minute to mostly return). */
export const PERF_RISE_S = 20;
const LABEL_MIN = 8;
const PART_CAP_MIN = 20;

let stress = 0;
let want = 0;
let lastTs = -1;
/** Start of the current 1-minute recovery sample (lean start or last view change). */
let recoverFrom = -1;

export function resetPerf(): void {
  stress = 0;
  want = 0;
  lastTs = -1;
  recoverFrom = -1;
}

export function perfStress(): number {
  return stress;
}

export function perfWant(): number {
  return want;
}

/** Restart the 1-minute recovered average after a view change while leaned. */
export function notePerfChange(ts = lastTs): void {
  if (want > 0 || stress > 0) recoverFrom = ts < 0 ? 0 : ts;
}

function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Advance the 0–1 lean amount. Call once per vsync from the main graph.
 * `ease` is moveEase (0 still glides ~1 min restore; 1 is slower). Dropping is the short tau.
 */
export function tickPerf(ts: number, enabled: boolean, ease = 0.45): number {
  if (ts === lastTs) return stress;
  const dt = lastTs < 0 ? 0 : Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
  lastTs = ts;
  const drop = windowFps(ts, PERF_HOLD_MS);
  if (!enabled) {
    want = 0;
    recoverFrom = -1;
  } else if (drop != null && drop < PERF_FPS) {
    want = 1;
    recoverFrom = ts;
  } else if (want > 0) {
    const since = recoverFrom < 0 ? Number.NEGATIVE_INFINITY : recoverFrom;
    const rec = windowFps(ts, PERF_RECOVER_MS, since);
    if (rec != null && rec > PERF_RECOVER_FPS) want = 0;
  }
  if (want < 1 && stress < 0.001) recoverFrom = -1;
  const rise = 15 + PERF_RISE_S * Math.min(1, Math.max(0, ease)) ** 2;
  const tau = want > stress ? PERF_DROP_S : rise;
  if (dt > 0) stress += (want - stress) * (1 - Math.exp(-dt / tau));
  if (stress < 0.001) stress = 0;
  if (stress > 0.999) stress = 1;
  return stress;
}

export interface PerfSrc {
  labelCount: number;
  partAmt: number;
  partCap: number;
  partPeak: number;
  partSize: number;
  edgeGlowAmt: number;
  skyBright: number;
  skyOpacity: number;
  skySpeed: number;
}

export interface PerfOverlay {
  k: number;
  labelCount: number;
  partAmt: number;
  partCap: number;
  partPeak: number;
  partSize: number;
  edgeGlowAmt: number;
  skyBright: number;
  skyOpacity: number;
  skySpeed: number;
  dprK: number;
}

export function perfOverlay(anim: PerfSrc, s = stress): PerfOverlay {
  const k = smooth(s);
  return {
    k,
    labelCount: Math.max(LABEL_MIN, Math.round(mix(anim.labelCount, LABEL_MIN, k))),
    partAmt: mix(anim.partAmt, 0.12, k),
    partCap: Math.max(PART_CAP_MIN, Math.round(mix(anim.partCap, 80, k))),
    partPeak: Math.max(4, Math.round(mix(anim.partPeak, 6, k))),
    partSize: mix(anim.partSize, 0.55, k),
    edgeGlowAmt: mix(anim.edgeGlowAmt, 0.2, k),
    skyBright: mix(anim.skyBright, 0.4, k),
    skyOpacity: mix(anim.skyOpacity, 0.45, k),
    skySpeed: mix(anim.skySpeed, 0.3, k),
    dprK: k,
  };
}
