/**
 * Tunables for resource limits and crash recovery. Defaults live here; override any subset with
 * `localStorage["zoto-viz.recovery"] = JSON.stringify({...})` (e.g. `{"fpsCap": 30}`) and reload.
 * Backend watchdog thresholds are env vars on the monitor (ZOTO_VIZ_WD_*), see service/page_health.py.
 */
import { DEFAULT_STREAM_CONFIG, type StreamConfig } from "./ws-stream";

export type RecoveryConfig = {
  /** wall frame cap in fps; 0 = uncapped (display refresh) */
  fpsCap: number;
  /** skip host frames when nothing is animating/dirty (views opt in via `needsFrame`) */
  idleSkip: boolean;
  /** consecutive throwing frames before a view is disabled */
  viewErrorBudget: number;
  /** GPU context losses within `contextLossWindowMs` before dropping to the low-quality tier */
  contextLossLimit: number;
  contextLossWindowMs: number;
  /** pixel ratio used by the low-quality tier */
  fallbackPixelRatio: number;
  heartbeatMs: number;
  /** soft self-reload after this many hours of uptime (0 = never) */
  softReloadAfterH: number;
  /** ... once there has been no input for this long */
  softReloadQuietMs: number;
  stream: StreamConfig;
};

export const DEFAULT_RECOVERY: RecoveryConfig = {
  fpsCap: 0,
  idleSkip: true,
  viewErrorBudget: 30,
  contextLossLimit: 3,
  contextLossWindowMs: 10 * 60_000,
  fallbackPixelRatio: 0.75,
  heartbeatMs: 10_000,
  softReloadAfterH: 12,
  softReloadQuietMs: 5 * 60_000,
  stream: DEFAULT_STREAM_CONFIG,
};

export const RECOVERY_KEY = "zoto-viz.recovery";

function num(v: unknown, d: number, min = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : d;
}

export function parseRecoveryConfig(raw: string | null | undefined): RecoveryConfig {
  let o: Record<string, unknown> = {};
  try { o = raw ? (JSON.parse(raw) as Record<string, unknown>) ?? {} : {}; } catch { o = {}; }
  if (typeof o !== "object" || Array.isArray(o)) o = {};
  const d = DEFAULT_RECOVERY;
  const s = (typeof o.stream === "object" && o.stream ? o.stream : {}) as Record<string, unknown>;
  return {
    fpsCap: num(o.fpsCap, d.fpsCap),
    idleSkip: typeof o.idleSkip === "boolean" ? o.idleSkip : d.idleSkip,
    viewErrorBudget: num(o.viewErrorBudget, d.viewErrorBudget, 1),
    contextLossLimit: num(o.contextLossLimit, d.contextLossLimit, 1),
    contextLossWindowMs: num(o.contextLossWindowMs, d.contextLossWindowMs, 1000),
    fallbackPixelRatio: Math.min(2, num(o.fallbackPixelRatio, d.fallbackPixelRatio, 0.25)),
    heartbeatMs: num(o.heartbeatMs, d.heartbeatMs, 1000),
    softReloadAfterH: num(o.softReloadAfterH, d.softReloadAfterH),
    softReloadQuietMs: num(o.softReloadQuietMs, d.softReloadQuietMs),
    stream: {
      staleMs: num(s.staleMs, d.stream.staleMs, 1000),
      backoffBaseMs: num(s.backoffBaseMs, d.stream.backoffBaseMs, 100),
      backoffMaxMs: num(s.backoffMaxMs, d.stream.backoffMaxMs, 100),
      jitter: Math.min(1, num(s.jitter, d.stream.jitter)),
      pauseWhenHidden: typeof s.pauseWhenHidden === "boolean" ? s.pauseWhenHidden : d.stream.pauseWhenHidden,
    },
  };
}

let cached: RecoveryConfig | null = null;

export function recoveryConfig(): RecoveryConfig {
  if (cached) return cached;
  let raw: string | null = null;
  try { raw = typeof localStorage !== "undefined" ? localStorage.getItem(RECOVERY_KEY) : null; } catch { raw = null; }
  cached = parseRecoveryConfig(raw);
  return cached;
}

export function resetRecoveryConfigForTests(): void { cached = null; }

export function streamConfigFromSettings(): StreamConfig { return recoveryConfig().stream; }
