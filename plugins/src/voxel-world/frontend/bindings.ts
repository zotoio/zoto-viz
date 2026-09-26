import type { VoxLiveBindings, VoxOptions } from "./config";
import {
  hostKeyFromPacket,
  HostSlotRegistry,
  hostWorldXZ,
  MAX_HOST_SLOTS,
  PACKETS_PER_FRAME_CAP,
  type VoxPacketRow,
  type VoxTalkerRow,
} from "./hosts";

export type VoxLiveFrame = {
  t: number;
  demo?: boolean;
  packets: VoxPacketRow[];
  talkers?: VoxTalkerRow[];
  sys?: { cpu: number; failed: number };
};

export interface VoxBeacon {
  hostId?: string;
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
  hostAnchors: Map<string, { x: number; z: number; label: number }>;
}

const ZOTO_FAIL = 0.94;

const hostRegistry = new HostSlotRegistry();

export function resetLiveMarkers(): void {
  hostRegistry.reset();
}

export function getHostRegistryForTest(): HostSlotRegistry {
  return hostRegistry;
}

function talkerRateById(talkers: VoxTalkerRow[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of talkers ?? []) {
    if (!t.id) continue;
    m.set(t.id, (m.get(t.id) ?? 0) + t.rate);
  }
  return m;
}

export function applyLiveBindings(
  frame: VoxLiveFrame,
  opts: VoxOptions,
  _prevPacketN: number,
  cam: { x: number; y: number; z: number },
): VoxLiveState {
  hostRegistry.tickFrame();
  const load = frame.sys?.cpu ?? (frame.demo ? 0.24 : 0.1);
  const sysFailed = frame.sys?.failed ?? 0;
  const rates = talkerRateById(frame.talkers);
  let eventRate = 0;
  for (const r of rates.values()) eventRate += r;
  if (!rates.size) {
    for (const p of frame.packets) eventRate += p.field * 100;
  }
  const eventNorm = Math.min(1, eventRate / 400);
  const weatherMix = Math.min(1, load * opts.live.sysLoadWeather
    + (opts.weather === "rain" || opts.weather === "snow" ? 0.12 : 0));
  const cloudCover = Math.min(1, eventNorm * opts.live.eventRateCloud + (opts.clouds ? 0.15 : 0));

  let failStrength = Math.min(1, sysFailed * opts.live.sysFailedFailBeacon * ZOTO_FAIL);
  for (const t of frame.talkers ?? []) {
    if (typeof t.failed === "number" && t.failed > 0) {
      failStrength = Math.max(failStrength, Math.min(1, t.failed * opts.live.sysFailedFailBeacon * ZOTO_FAIL));
    }
  }

  const yBase = cam.y - 1.2;
  hostRegistry.syncTalkers(frame.talkers ?? [], opts.seed, yBase);

  const toProcess = frame.packets.slice(0, PACKETS_PER_FRAME_CAP);
  for (const p of toProcess) {
    const hostId = hostKeyFromPacket(p);
    if (!hostId) continue;
    if (typeof p.failed === "number" && p.failed > 0) {
      hostRegistry.setFail(hostId, opts.seed, p.failed, yBase);
      continue;
    }
    const kind = p.field >= opts.live.packetFieldTorch ? 1
      : p.field >= opts.live.packetFieldBlock ? 2 : 0;
    if (!kind) continue;
    hostRegistry.upsertFlow(hostId, opts.seed, kind, yBase);
  }

  if (failStrength > 0.08) {
    hostRegistry.setFail("__sys__", opts.seed, failStrength, yBase);
  }

  const hostAnchors = new Map<string, { x: number; z: number; label: number }>();
  for (const id of rates.keys()) {
    hostAnchors.set(id, hostWorldXZ(id, opts.seed));
  }

  const beacons: VoxBeacon[] = hostRegistry.values()
    .filter((s) => s.kind > 0)
    .sort((a, b) => a.hostId.localeCompare(b.hostId))
    .slice(0, MAX_HOST_SLOTS)
    .map((s) => ({
      hostId: s.hostId,
      x: s.x,
      y: s.y,
      z: s.z,
      kind: s.kind,
      strength: s.kind === 9 ? s.fail : s.strength,
      label: s.label,
    }));

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
    hostAnchors,
  };
}
