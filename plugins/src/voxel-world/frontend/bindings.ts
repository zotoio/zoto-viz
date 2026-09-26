import type { VoxLiveBindings, VoxOptions } from "./config";

export type VoxLiveFrame = {
  t: number;
  demo?: boolean;
  packets: { field: number }[];
  talkers?: { rate: number }[];
  sys?: { cpu: number; failed: number };
};

export interface VoxBeacon {
  x: number;
  y: number;
  z: number;
  kind: number;
  strength: number;
}

export interface VoxLiveState {
  weatherMix: number;
  cloudCover: number;
  failStrength: number;
  demo: boolean;
  metric: number;
  metricLabel: number;
  beacons: VoxBeacon[];
  torchPulse: number;
}

const ZOTO_FAIL = 0.94;
const MAX_BEACONS = 6;

let flowMarkers: VoxBeacon[] = [];
let failMarkers: VoxBeacon[] = [];

export function resetLiveMarkers(): void {
  flowMarkers = [];
  failMarkers = [];
}

export function applyLiveBindings(
  frame: VoxLiveFrame,
  opts: VoxOptions,
  prevPacketN: number,
  cam: { x: number; y: number; z: number },
): VoxLiveState {
  const load = frame.sys?.cpu ?? (frame.demo ? 0.24 : 0.1);
  const failed = frame.sys?.failed ?? 0;
  const eventRate = frame.talkers?.reduce((s, t) => s + t.rate, 0)
    ?? frame.packets.reduce((s, p) => s + p.field * 100, 0);
  const eventNorm = Math.min(1, eventRate / 400);
  const weatherMix = Math.min(1, load * opts.live.sysLoadWeather
    + (opts.weather === "rain" || opts.weather === "snow" ? 0.12 : 0));
  const cloudCover = Math.min(1, eventNorm * opts.live.eventRateCloud + (opts.clouds ? 0.15 : 0));
  const failStrength = Math.min(1, failed * opts.live.sysFailedFailBeacon * ZOTO_FAIL);

  const n = frame.packets.length;
  const newFlows = Math.max(0, n - prevPacketN);
  if (newFlows > 0) {
    for (let i = 0; i < newFlows && flowMarkers.length < MAX_BEACONS; i++) {
      const p = frame.packets[frame.packets.length - 1 - i];
      if (!p) continue;
      const ang = frame.t * 0.7 + flowMarkers.length;
      const kind = p.field >= opts.live.packetFieldTorch ? 1 : p.field >= opts.live.packetFieldBlock ? 2 : 0;
      if (!kind) continue;
      flowMarkers.push({
        x: cam.x + Math.cos(ang) * 4,
        y: cam.y - 1.2,
        z: cam.z + Math.sin(ang) * 4,
        kind,
        strength: 1,
      });
    }
  }
  if (flowMarkers.length > MAX_BEACONS) flowMarkers = flowMarkers.slice(-MAX_BEACONS);

  if (failStrength > 0.08) {
    const beacon: VoxBeacon = {
      x: cam.x + 3,
      y: cam.y + 2,
      z: cam.z - 2,
      kind: 9,
      strength: failStrength,
    };
    failMarkers = [beacon];
  } else if (!frame.demo) {
    failMarkers = [];
  } else if (failMarkers.length === 0) {
    failMarkers = [{ x: cam.x + 5, y: cam.y + 1, z: cam.z, kind: 9, strength: 0.15 }];
  }

  const torchPulse = flowMarkers.some((b) => b.kind === 1) ? 1 : 0;
  const metric = Math.round(load * 100);
  const metricLabel = failStrength > 0.2 ? 2 : eventNorm > 0.15 ? 1 : 0;

  return {
    weatherMix,
    cloudCover,
    failStrength,
    demo: !!frame.demo,
    metric,
    metricLabel,
    beacons: [...failMarkers, ...flowMarkers].slice(0, MAX_BEACONS),
    torchPulse,
  };
}
