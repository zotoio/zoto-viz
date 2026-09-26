import type { VoxOptions } from "./config";
import {
  forEachProtoMarker,
  forEachTalkerMarker,
  syncProtoFlowMarkers,
  syncTalkerLayout,
  resetFlowCaches,
} from "./talker-cache";
import {
  beginCandidatePass,
  commitScreenMarkers,
  offerMarker,
  readScreenMarker,
  resetTopMarkers,
  SCREEN_MARKER_SLOTS,
} from "./marker-select";
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
  beaconCount: number;
  torchPulse: number;
}

const ZOTO_FAIL = 0.94;
const beaconOut: VoxBeacon[] = Array.from({ length: SCREEN_MARKER_SLOTS }, () => ({
  key: "",
  x: 0,
  y: 0,
  z: 0,
  kind: 0,
  strength: 0,
}));

export function resetLiveMarkers(): void {
  resetFlowCaches();
  resetTopMarkers();
}

export function applyLiveBindings(
  frame: VoxLiveFrame,
  opts: VoxOptions,
  cam: { x: number; y: number; z: number },
  dt = 1 / 60,
): VoxLiveState {
  const load = frame.sys?.cpu ?? (frame.demo ? 0.24 : 0.1);
  const sysFailed = frame.sys?.failed ?? 0;
  const failStrength = Math.min(1, sysFailed * opts.live.sysFailedFailBeacon * ZOTO_FAIL);

  const yBase = cam.y - 1.2;
  const talkerLayout = syncTalkerLayout(frame.talkers, opts.seed, yBase);
  let eventRate = talkerLayout.eventRate;
  if (!eventRate) {
    const n = frame.packets.length;
    const cap = n < 8 ? n : 8;
    for (let i = 0; i < cap; i++) eventRate += frame.packets[i]!.field * 100;
  }
  const eventNorm = Math.min(1, eventRate / 400);
  const weatherMix = Math.min(1, load * opts.live.sysLoadWeather
    + (opts.weather === "rain" || opts.weather === "snow" ? 0.12 : 0));
  const cloudCover = Math.min(1, eventNorm * opts.live.eventRateCloud + (opts.clouds ? 0.15 : 0));

  syncProtoFlowMarkers(
    frame.packets,
    opts.seed,
    yBase,
    opts.live.packetFieldTorch,
    opts.live.packetFieldBlock,
  );

  beginCandidatePass();
  forEachTalkerMarker((m) => offerMarker(m));
  forEachProtoMarker((m) => offerMarker(m));
  commitScreenMarkers(frame.t, dt);

  let beaconCount = 0;
  let torchPulse = 0;
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const m = readScreenMarker(i);
    const b = beaconOut[i]!;
    if (!m) {
      b.kind = 0;
      b.strength = 0;
      b.key = "";
      continue;
    }
    b.key = m.key;
    b.x = m.x;
    b.y = m.y;
    b.z = m.z;
    b.kind = m.kind;
    b.strength = m.display;
    b.label = m.label;
    beaconCount++;
    if (m.kind === 1 && m.display > 0.15) torchPulse = 1;
  }

  const metric = Math.round(load * 100);
  const metricLabel = failStrength > 0.2 ? 2 : eventNorm > 0.15 ? 1 : 0;

  return {
    weatherMix,
    cloudCover,
    failStrength,
    demo: !!frame.demo,
    metric,
    metricLabel,
    beaconCount,
    torchPulse,
  };
}

export function beaconScratch(): readonly VoxBeacon[] {
  return beaconOut;
}
