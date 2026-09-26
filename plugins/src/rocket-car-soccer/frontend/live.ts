/**
 * Live monitor → visible match effects. Mirrors `liveMapping` in plugin.yml.
 * Uses the host {@link VizDataFrame} contract only — no invented frame fields.
 */

import type { VizDataFrame } from "../../../sdk/viz-contract";

/** Host decimation cap for packet rows (matches `VIZ_MAX_PACKET_SAMPLES` in the monitor). */
export const RCS_PACKET_SLICE_CAP = 32;

export type { VizDataFrame };

export const RCS_LIVE_MAPPING = [
  { field: "talkers.rate", effect: "carBoost", default: 0.35, min: 0, max: 1 },
  { field: "packets.field", effect: "goalPulse", default: 0.15, min: 0, max: 1 },
  { field: "sys.failed", effect: "failAlert", default: 0, min: 0, max: 1 },
  { field: "sys.udev", effect: "eventPulse", default: 0, min: 0, max: 1 },
] as const;

export interface RcsLiveDrive {
  demo: boolean;
  flowMetric: number;
  /** Max packet `field` this frame (goal FX only — never fail visuals). */
  goalPulse: number;
  /** Stadium-wide alert from `sys.failed` only. */
  failAlert: number;
  eventPulse: number;
  perHostBoost: ReadonlyMap<string, number>;
  perHostLabel: ReadonlyMap<string, number>;
  packetsConsumed: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function hostLabelHash(talkerId: string): number {
  let h = 0;
  for (let i = 0; i < talkerId.length; i++) h = (h * 31 + talkerId.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

function boostFromRate(rate: number): number {
  const def = RCS_LIVE_MAPPING[0]!.default;
  const scaled = clamp(rate / 90, RCS_LIVE_MAPPING[0]!.min, RCS_LIVE_MAPPING[0]!.max);
  return scaled > 0 ? scaled : def;
}

function failFromSys(failed: number | undefined): number {
  if (!Number.isFinite(failed) || failed === undefined) return 0;
  return failed > 0 ? clamp(failed, 0, 1) : 0;
}

let talkerIdKey = "";
const cachedBoost = new Map<string, number>();
const cachedLabel = new Map<string, number>();

function talkerIdSetKey(talkers: VizDataFrame["talkers"]): string {
  const ids = talkers.map((t) => t.id).filter(Boolean);
  ids.sort();
  return ids.join("\0");
}

/** Rebuild talker-derived maps only when the set of talker ids changes. */
function syncTalkerCache(talkers: VizDataFrame["talkers"]): void {
  const key = talkerIdSetKey(talkers);
  if (key !== talkerIdKey) {
    talkerIdKey = key;
    cachedBoost.clear();
    cachedLabel.clear();
    for (const t of talkers) {
      if (!t.id) continue;
      cachedLabel.set(t.id, hostLabelHash(t.id));
      cachedBoost.set(t.id, boostFromRate(t.rate));
    }
    return;
  }
  for (const t of talkers) {
    if (!t.id || !cachedBoost.has(t.id)) continue;
    cachedBoost.set(t.id, boostFromRate(t.rate));
  }
}

export function resetRcsTalkerCacheForTest(): void {
  talkerIdKey = "";
  cachedBoost.clear();
  cachedLabel.clear();
}

export function ingestLiveFrame(frame: VizDataFrame | undefined): RcsLiveDrive {
  const demo = frame?.demo === true;
  const talkers = frame?.talkers ?? [];
  syncTalkerCache(talkers);

  let flowMetric = 0;
  for (const t of talkers) flowMetric = Math.max(flowMetric, t.rate ?? 0);

  let goalPulse = 0;
  let packetsConsumed = 0;
  const packets = frame?.packets ?? [];
  const limit = Math.min(packets.length, RCS_PACKET_SLICE_CAP);
  for (let i = 0; i < limit; i++) {
    const p = packets[i]!;
    if (!Number.isFinite(p.field)) continue;
    packetsConsumed++;
    goalPulse = Math.max(goalPulse, clamp(p.field, 0, 1));
  }

  const udev = frame?.sys?.udev ?? 0;
  return {
    demo,
    flowMetric,
    goalPulse,
    failAlert: failFromSys(frame?.sys?.failed),
    eventPulse: clamp(Number.isFinite(udev) ? udev : 0, 0, 1),
    perHostBoost: cachedBoost,
    perHostLabel: cachedLabel,
    packetsConsumed,
  };
}

/** Zoto Fail red (matches units graph failed colour). */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];
