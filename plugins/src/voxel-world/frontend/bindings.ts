import type { VoxOptions } from "./config";
import {
  anchorXZ,
  MAX_FLOW_MARKERS,
  syncProtoFlowMarkers,
  syncTalkerLayout,
  type FlowMarker,
  resetFlowCaches,
} from "./talker-cache";
import type { VoxelVizInput } from "./viz-frame";

export type VoxLiveFrame = VoxelVizInput;

export interface VoxBeacon {
  key: string;
  x: number;
  y: number;
  z: number;
  kind: number;
  strength: number;
  label?: number;
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
  talkerAnchors: Map<string, { x: number; z: number; label: number }>;
}

const ZOTO_FAIL = 0.94;

export function resetLiveMarkers(): void {
  resetFlowCaches();
}

export function applyLiveBindings(
  frame: VoxLiveFrame,
  opts: VoxOptions,
  cam: { x: number; y: number; z: number },
): VoxLiveState {
  const load = frame.sys?.cpu ?? (frame.demo ? 0.24 : 0.1);
  const sysFailed = frame.sys?.failed ?? 0;
  const failStrength = Math.min(1, sysFailed * opts.live.sysFailedFailBeacon * ZOTO_FAIL);

  const yBase = cam.y - 1.2;
  const talkerLayout = syncTalkerLayout(frame.talkers, opts.seed, yBase);
  let eventRate = 0;
  for (const r of talkerLayout.rateById.values()) eventRate += r;
  if (!talkerLayout.rateById.size) {
    for (const p of frame.packets) eventRate += p.field * 100;
  }
  const eventNorm = Math.min(1, eventRate / 400);
  const weatherMix = Math.min(1, load * opts.live.sysLoadWeather
    + (opts.weather === "rain" || opts.weather === "snow" ? 0.12 : 0));
  const cloudCover = Math.min(1, eventNorm * opts.live.eventRateCloud + (opts.clouds ? 0.15 : 0));

  const protoFlows = syncProtoFlowMarkers(
    frame.packets,
    opts.seed,
    yBase,
    opts.live.packetFieldTorch,
    opts.live.packetFieldBlock,
  );

  const merged = new Map<string, FlowMarker>();
  for (const m of talkerLayout.markers) if (m.kind) merged.set(`t:${m.key}`, m);
  for (const m of protoFlows) merged.set(`p:${m.key}`, m);

  const beacons: VoxBeacon[] = [...merged.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, MAX_FLOW_MARKERS)
    .map((m) => ({
      key: m.key,
      x: m.x,
      y: m.y,
      z: m.z,
      kind: m.kind,
      strength: m.strength,
      label: m.label,
    }));

  const talkerAnchors = new Map<string, { x: number; z: number; label: number }>();
  for (const id of talkerLayout.rateById.keys()) {
    const a = anchorXZ(id, opts.seed);
    talkerAnchors.set(id, { x: a.x, z: a.z, label: a.label });
  }

  const torchPulse = beacons.some((b) => b.kind === 1) ? 1 : 0;
  const metric = Math.round(load * 100);
  const metricLabel = failStrength > 0.2 ? 2 : eventNorm > 0.15 ? 1 : 0;

  return {
    weatherMix,
    cloudCover,
    failStrength,
    demo: !!frame.demo,
    metric,
    metricLabel,
    beacons,
    torchPulse,
    talkerAnchors,
  };
}
