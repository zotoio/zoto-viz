/**
 * Live monitor → visible match effects. Mirrors `liveMapping` in visualisation.yml / plugin.yml.
 */

export const RCS_LIVE_MAPPING = [
  { field: "talkers.rate", effect: "carBoost", default: 0.35, min: 0, max: 1 },
  { field: "packets.field", effect: "goalPulse", default: 0.15, min: 0, max: 1 },
  { field: "sys.failed", effect: "failAlert", default: 0, min: 0, max: 1 },
  { field: "sys.udev", effect: "eventPulse", default: 0, min: 0, max: 1 },
] as const;

export interface RcsLiveDrive {
  boost: number;
  goalPulse: number;
  failAlert: number;
  eventPulse: number;
  flowMetric: number;
  demo: boolean;
}

export type RcsVizFrame = {
  demo?: boolean;
  talkers?: { rate: number }[];
  packets?: { field: number }[];
  sys?: { failed?: number; udev?: number };
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function driveFromFrame(frame: RcsVizFrame | undefined): RcsLiveDrive {
  const demo = frame?.demo === true;
  const talkers = frame?.talkers ?? [];
  let peak = 0;
  for (const t of talkers) peak = Math.max(peak, t.rate ?? 0);
  const boostDef = RCS_LIVE_MAPPING[0]!.default;
  const pkt = frame?.packets?.[0]?.field ?? 0;
  const failed = frame?.sys?.failed ?? 0;
  const udev = frame?.sys?.udev ?? 0;
  return {
    boost: clamp(peak / 90, RCS_LIVE_MAPPING[0]!.min, RCS_LIVE_MAPPING[0]!.max) || boostDef,
    goalPulse: clamp(Number.isFinite(pkt) ? pkt : 0, 0, 1),
    failAlert: clamp(Number.isFinite(failed) ? failed : 0, 0, 1),
    eventPulse: clamp(Number.isFinite(udev) ? udev : 0, 0, 1),
    flowMetric: peak,
    demo,
  };
}

/** Zoto Fail red (matches units graph failed colour). */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];
