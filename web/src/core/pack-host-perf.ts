/**
 * Pack-host frame instrumentation (near-zero cost when disabled).
 * Enabled = localStorage `zoto-viz.packPerf` === "1" OR the boot URL has `?packPerf` (OR, as before #196).
 * The flag is resolved once at module init and cached: hooks and caller gates read a boolean, never
 * storage or the URL (#196). `?packPerf` is read at init only, so changing it needs a reload.
 * localStorage changes are live: other tabs via the `storage` event, same tab via
 * {@link refreshPackPerfEnabled}. While the boot URL has `?packPerf`, turning localStorage off does
 * not disable recording until a reload.
 */

import { harvestGpu } from "./gpu-time";

export const PACK_PERF_STORE = "zoto-viz.packPerf";

const SAMPLE_CAP = 600;
const HITCH_MINOR_MS = 25;
const HITCH_MAJOR_MS = 50;

export type PackHostPerfSnapshot = {
  enabled: boolean;
  sinceMs: number;
  frames: number;
  frameMs: { last: number; p50: number; p99: number };
  hitches: { over25: number; over50: number };
  gpuMs: { last: number; p50: number; p99: number; samples: number };
  packs: Record<string, { onFramePerSec: number; onPresentPerSec: number; sandboxFramePerSec: number }>;
  writes: { messagesPerFrame: number; bytesPerFrame: number; batchesPerFrame: number };
  presentTicks: number;
};

type PackCounters = {
  onFrame: number;
  onPresent: number;
  sandboxFrame: number;
  windowStart: number;
};

let enabled = false;
let sinceMs = 0;
let frameCount = 0;
const frameSamples: number[] = [];
const gpuSamples: number[] = [];
let hitches25 = 0;
let hitches50 = 0;
let lastFrameMs = 0;
let lastGpuMs = 0;
let presentTicks = 0;
let writeMessages = 0;
let writeBytes = 0;
let writeBatches = 0;
let writeFrames = 0;
let writeMessagesWindow = 0;
let writeBytesWindow = 0;
let writeBatchesWindow = 0;
const packCounters = new Map<string, PackCounters>();

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function p50p99(samples: number[]): { p50: number; p99: number } {
  if (!samples.length) return { p50: 0, p99: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p99: percentile(sorted, 0.99) };
}

/** Boot `?packPerf`: read once at module init (changing it needs a reload). */
let bootUrlOn = false;
/** Last read of localStorage `zoto-viz.packPerf` === "1" (init, `storage` event, refresh). */
let storeOn = false;
/** Cached flag: storeOn OR bootUrlOn. */
let flagOn = false;

function readStoreOn(): boolean {
  try {
    return localStorage.getItem(PACK_PERF_STORE) === "1";
  } catch {
    return false;
  }
}

function readBootUrlOn(): boolean {
  try {
    return new URLSearchParams(window.location.search).has("packPerf");
  } catch {
    return false;
  }
}

function applyFlag(): boolean {
  const was = flagOn;
  flagOn = storeOn || bootUrlOn;
  if (was && !flagOn) resetPackHostPerf();
  return flagOn;
}

/**
 * Re-read localStorage `zoto-viz.packPerf` after a same-tab change (other tabs arrive via the
 * `storage` event). One storage read per call; never per frame.
 */
export function refreshPackPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  storeOn = readStoreOn();
  return applyFlag();
}

function onPackPerfStorage(ev: StorageEvent): void {
  // key null: localStorage.clear() in another tab.
  if (ev.key !== null && ev.key !== PACK_PERF_STORE) return;
  refreshPackPerfEnabled();
}

if (typeof window !== "undefined") {
  bootUrlOn = readBootUrlOn();
  storeOn = readStoreOn();
  flagOn = storeOn || bootUrlOn;
  window.addEventListener("storage", onPackPerfStorage);
}

/** Cached flag: one boolean read (#196). */
export function packPerfEnabled(): boolean {
  return flagOn;
}

function ensureEnabled(): boolean {
  const on = flagOn;
  if (on && !enabled) {
    enabled = true;
    sinceMs = performance.now();
  }
  if (!on && enabled) resetPackHostPerf();
  enabled = on;
  return enabled;
}

function packRow(packId: string): PackCounters {
  let row = packCounters.get(packId);
  if (!row) {
    row = { onFrame: 0, onPresent: 0, sandboxFrame: 0, windowStart: performance.now() };
    packCounters.set(packId, row);
  }
  return row;
}

export function resetPackHostPerf(): void {
  enabled = false;
  sinceMs = 0;
  frameCount = 0;
  frameSamples.length = 0;
  gpuSamples.length = 0;
  hitches25 = 0;
  hitches50 = 0;
  lastFrameMs = 0;
  lastGpuMs = 0;
  presentTicks = 0;
  writeMessages = 0;
  writeBytes = 0;
  writeBatches = 0;
  writeFrames = 0;
  writeMessagesWindow = 0;
  writeBytesWindow = 0;
  writeBatchesWindow = 0;
  packCounters.clear();
}

export function notePackHostPresentInterval(ms: number): void {
  if (!ensureEnabled() || !Number.isFinite(ms) || ms <= 0) return;
  lastFrameMs = ms;
  frameSamples.push(ms);
  if (frameSamples.length > SAMPLE_CAP) frameSamples.shift();
  frameCount++;
  if (ms > HITCH_MINOR_MS) hitches25++;
  if (ms > HITCH_MAJOR_MS) hitches50++;
  harvestGpu();
}

export function notePackHostGpuMs(ms: number): void {
  if (!ensureEnabled() || !Number.isFinite(ms) || ms <= 0) return;
  lastGpuMs = ms;
  gpuSamples.push(ms);
  if (gpuSamples.length > SAMPLE_CAP) gpuSamples.shift();
}

export function notePackSandboxFrame(packId: string): void {
  if (!ensureEnabled() || !packId) return;
  packRow(packId).sandboxFrame++;
}

export function notePackPresentDelivery(packId: string): void {
  if (!ensureEnabled() || !packId) return;
  packRow(packId).onPresent++;
  presentTicks++;
}

export function notePackWriteBatch(messages: number, bytes: number): void {
  if (!ensureEnabled()) return;
  writeMessages += messages;
  writeBytes += bytes;
  writeBatches++;
  writeMessagesWindow += messages;
  writeBytesWindow += bytes;
  writeBatchesWindow++;
  writeFrames++;
}

export function packHostPerfSnapshot(now = performance.now()): PackHostPerfSnapshot {
  const on = ensureEnabled();
  const elapsedSec = on && sinceMs > 0 ? Math.max(0.001, (now - sinceMs) / 1000) : 0;
  const frameStats = p50p99(frameSamples);
  const gpuStats = p50p99(gpuSamples);
  const packs: PackHostPerfSnapshot["packs"] = {};
  for (const [id, row] of packCounters) {
    const sec = Math.max(0.001, (now - row.windowStart) / 1000);
    packs[id] = {
      onFramePerSec: row.onFrame / sec,
      onPresentPerSec: row.onPresent / sec,
      sandboxFramePerSec: row.sandboxFrame / sec,
    };
  }
  const wf = Math.max(1, writeFrames);
  return {
    enabled: on,
    sinceMs: on ? sinceMs : 0,
    frames: frameCount,
    frameMs: { last: lastFrameMs, ...frameStats },
    hitches: { over25: hitches25, over50: hitches50 },
    gpuMs: { last: lastGpuMs, ...gpuStats, samples: gpuSamples.length },
    packs,
    writes: {
      messagesPerFrame: writeMessagesWindow / wf,
      bytesPerFrame: writeBytesWindow / wf,
      batchesPerFrame: writeBatchesWindow / wf,
    },
    presentTicks,
  };
}

/** Cheap no-op when disabled — one boolean read. */
export function packHostPerfIsOn(): boolean {
  return enabled || flagOn;
}
