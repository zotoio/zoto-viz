/**
 * Live monitor → visible match effects. Mirrors `liveMapping` in plugin.yml.
 * Host ids are stable keys — never list index or talker count.
 */

export const RCS_LIVE_MAPPING = [
  { field: "talkers.rate", effect: "carBoost", default: 0.35, min: 0, max: 1 },
  { field: "packets.field", effect: "goalPulse", default: 0.15, min: 0, max: 1 },
  { field: "sys.failed", effect: "failAlert", default: 0, min: 0, max: 1 },
  { field: "sys.udev", effect: "eventPulse", default: 0, min: 0, max: 1 },
] as const;

/** Matches host viz decimation cap (`VIZ_MAX_PACKET_SAMPLES`). */
export const RCS_PACKET_FRAME_CAP = 32;

export type RcsTalker = { id: string; rate: number; role?: string };
/** `host` is the packet source host id (required for live mapping; proto is demo-only fallback). */
export type RcsPacket = { proto: string; size?: number; field: number; host?: string };

export type RcsVizFrame = {
  demo?: boolean;
  talkers?: RcsTalker[];
  packets?: RcsPacket[];
  sys?: { failed?: number; udev?: number };
};

export interface RcsLiveDrive {
  demo: boolean;
  flowMetric: number;
  /** Ball nudge strength aggregated from packet fields (never used for fail visuals). */
  goalPulse: number;
  /** Only from `sys.failed` — never from packet `field` or rate thresholds. */
  failAlert: number;
  eventPulse: number;
  perHostBoost: ReadonlyMap<string, number>;
  perHostGoalPulse: ReadonlyMap<string, number>;
  perHostLabel: ReadonlyMap<string, number>;
  packetsConsumed: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function hostLabelHash(hostId: string): number {
  let h = 0;
  for (let i = 0; i < hostId.length; i++) h = (h * 31 + hostId.charCodeAt(i)) >>> 0;
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

function packetHostKey(p: RcsPacket): string {
  if (p.host && p.host.length > 0) return p.host;
  return `proto:${p.proto}`;
}

export function ingestLiveFrame(frame: RcsVizFrame | undefined): RcsLiveDrive {
  const demo = frame?.demo === true;
  const talkers = frame?.talkers ?? [];
  const packets = frame?.packets ?? [];
  const perHostBoost = new Map<string, number>();
  const perHostGoalPulse = new Map<string, number>();
  const perHostLabel = new Map<string, number>();

  let flowMetric = 0;
  for (const t of talkers) {
    if (!t.id) continue;
    const b = boostFromRate(t.rate ?? 0);
    perHostBoost.set(t.id, b);
    perHostLabel.set(t.id, hostLabelHash(t.id));
    flowMetric = Math.max(flowMetric, t.rate ?? 0);
  }

  let goalPulse = 0;
  let packetsConsumed = 0;
  const limit = Math.min(packets.length, RCS_PACKET_FRAME_CAP);
  for (let i = 0; i < limit; i++) {
    const p = packets[i]!;
    if (!Number.isFinite(p.field)) continue;
    packetsConsumed++;
    const host = packetHostKey(p);
    const pulse = clamp(p.field, 0, 1);
    perHostGoalPulse.set(host, Math.max(perHostGoalPulse.get(host) ?? 0, pulse));
    goalPulse = Math.max(goalPulse, pulse);
  }

  const udev = frame?.sys?.udev ?? 0;
  return {
    demo,
    flowMetric,
    goalPulse,
    failAlert: failFromSys(frame?.sys?.failed),
    eventPulse: clamp(Number.isFinite(udev) ? udev : 0, 0, 1),
    perHostBoost,
    perHostGoalPulse,
    perHostLabel,
    packetsConsumed,
  };
}

/** @deprecated use ingestLiveFrame */
export function driveFromFrame(frame: RcsVizFrame | undefined): RcsLiveDrive {
  return ingestLiveFrame(frame);
}

/** Zoto Fail red (matches units graph failed colour). */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];
