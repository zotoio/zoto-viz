import type { VoxLiveBindings, VoxOptions } from "./config";

export type VoxLiveFrame = {
  t: number;
  demo?: boolean;
  packets: { field: number }[];
  sys?: { cpu: number; failed: number };
};

export interface VoxLiveState {
  weatherMix: number;
  failTint: number;
  torchPulse: number;
  demo: boolean;
  metric: number;
  newFlows: number;
}

const ZOTO_FAIL = 0.92;

export function applyLiveBindings(
  frame: VoxLiveFrame,
  opts: VoxOptions,
  prevPacketN: number,
): VoxLiveState {
  const load = frame.sys?.cpu ?? (frame.demo ? 0.22 : 0.08);
  const failed = frame.sys?.failed ?? 0;
  const weatherMix = Math.min(1, load * opts.live.sysLoadWeather + (opts.weather === "rain" || opts.weather === "snow" ? 0.15 : 0));
  const failTint = Math.min(1, failed * opts.live.sysFailedFailTint * ZOTO_FAIL);
  const n = frame.packets.length;
  const newFlows = Math.max(0, n - prevPacketN);
  const torchPulse = newFlows > 0 && frame.packets.some((p) => p.field >= opts.live.packetFieldTorch) ? 1 : 0;
  return {
    weatherMix,
    failTint,
    torchPulse,
    demo: !!frame.demo,
    metric: Math.round(load * 100),
    newFlows,
  };
}
