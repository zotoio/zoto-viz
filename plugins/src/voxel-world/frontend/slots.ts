import type { VoxLiveState } from "./bindings";
import { beaconScratch } from "./bindings";
import type { VoxOptions } from "./config";
import type { MeshEngineStats } from "./mesh";
import { SCREEN_MARKER_SLOTS } from "./marker-select";
import { sunDir, villageAnchor, voxelCamera } from "./world";

export const VOX_SLOT = {
  mark: 0,
  camX: 1, camY: 2, camZ: 3, yaw: 4, pitch: 5, aspect: 6, day: 7,
  seed: 8, biome: 9, viewDist: 10, fog: 11, weather: 12, camMode: 13, camSpeed: 14, flags: 15,
  sunX: 16, sunY: 17, sunZ: 18, sunPow: 19, torch: 20, palette: 21, texStyle: 22,
  failStrength: 23, weatherMix: 24, demo: 25, metric: 26, cloudCover: 27,
  villageX: 28, villageZ: 29, drawCalls: 30, triangles: 31,
} as const;

export const VOX_SLOT0_FLOATS = 32;
export const VOX_SLOT1_FLOATS = 24;

const slot0Buf: number[] = new Array(VOX_SLOT0_FLOATS).fill(0);
const slot1Buf: number[] = new Array(VOX_SLOT1_FLOATS).fill(0);

export function persistentSlotBuffers(): { slot0: number[]; slot1: number[] } {
  return { slot0: slot0Buf, slot1: slot1Buf };
}

function biomeMix(b: VoxOptions["biome"]): number {
  return { temperate: 0.25, boreal: 0.55, arid: 0.75, islands: 0.45 }[b];
}

function weatherId(w: VoxOptions["weather"]): number {
  return { clear: 0, rain: 1, snow: 2 }[w];
}

function camId(c: VoxOptions["camera"]): number {
  return { fly: 0, walk: 1, orbit: 2 }[c];
}

function presetId(p: VoxOptions["preset"]): number {
  return { classic: 0, snowy: 1, desert: 2, night: 3, archipelago: 4, custom: 5 }[p];
}

export function packSlot0(
  t: number,
  aspect: number,
  o: VoxOptions,
  live: VoxLiveState,
  mesh: MeshEngineStats,
  _gpuBytes: number,
  _skips: number,
): number[] {
  const dayHours = (o.timeOfDay + (o.cycleSpeed / 60) * t) % 24;
  const dayFrac = dayHours / 24;
  const cam = voxelCamera(t, o, o.reducedMotion);
  const village = villageAnchor(o.seed, o.biome);
  const [sx, sy, sz] = sunDir(dayFrac);
  const sunPow = Math.min(1, Math.max(0.08, sy * 0.85 + 0.12));
  const torch = dayFrac < 0.28 || dayFrac > 0.72 ? 0.85 : 0.1 + live.torchPulse * 0.6;
  slot0Buf.fill(0);
  slot0Buf[VOX_SLOT.mark] = 1;
  slot0Buf[VOX_SLOT.camX] = cam.x;
  slot0Buf[VOX_SLOT.camY] = cam.y;
  slot0Buf[VOX_SLOT.camZ] = cam.z;
  slot0Buf[VOX_SLOT.yaw] = cam.yaw;
  slot0Buf[VOX_SLOT.pitch] = cam.pitch;
  slot0Buf[VOX_SLOT.aspect] = aspect;
  slot0Buf[VOX_SLOT.day] = dayFrac;
  slot0Buf[VOX_SLOT.seed] = o.seed;
  slot0Buf[VOX_SLOT.biome] = biomeMix(o.biome);
  slot0Buf[VOX_SLOT.viewDist] = o.viewDist;
  slot0Buf[VOX_SLOT.fog] = o.fog;
  slot0Buf[VOX_SLOT.weather] = weatherId(o.weather);
  slot0Buf[VOX_SLOT.camMode] = camId(o.camera);
  slot0Buf[VOX_SLOT.camSpeed] = o.cameraSpeed;
  const mobN = Math.min(o.caps.maxMobs, Math.max(0, Math.round(o.mobs)));
  slot0Buf[VOX_SLOT.flags] =
    (o.clouds ? 1 : 0)
    | (o.reducedMotion ? 2 : 0)
    | (live.metricLabel << 2)
    | (presetId(o.preset) << 4)
    | (mobN << 8);
  slot0Buf[VOX_SLOT.sunX] = sx;
  slot0Buf[VOX_SLOT.sunY] = sy;
  slot0Buf[VOX_SLOT.sunZ] = sz;
  slot0Buf[VOX_SLOT.sunPow] = sunPow * (1 - live.failStrength * 0.65);
  slot0Buf[VOX_SLOT.torch] = torch;
  slot0Buf[VOX_SLOT.palette] = { verdant: 0, sunset: 1, alpine: 2, candy: 3 }[o.palette];
  slot0Buf[VOX_SLOT.texStyle] = { crisp: 0, smooth: 1, painterly: 2 }[o.textureStyle];
  slot0Buf[VOX_SLOT.failStrength] = live.failStrength;
  slot0Buf[VOX_SLOT.weatherMix] = live.weatherMix;
  slot0Buf[VOX_SLOT.demo] = live.demo ? 1 : 0;
  slot0Buf[VOX_SLOT.metric] = live.metric;
  slot0Buf[VOX_SLOT.cloudCover] = live.cloudCover;
  slot0Buf[VOX_SLOT.villageX] = village.x;
  slot0Buf[VOX_SLOT.villageZ] = village.z;
  slot0Buf[VOX_SLOT.drawCalls] = mesh.drawCalls;
  slot0Buf[VOX_SLOT.triangles] = mesh.triangles;
  return slot0Buf;
}

export function packSlot1Mobs(
  _t: number,
  _o: VoxOptions,
  _cam: { x: number; z: number },
  _live: VoxLiveState,
): number[] {
  slot1Buf.fill(0);
  const beacons = beaconScratch();
  for (let b = 0; b < SCREEN_MARKER_SLOTS; b++) {
    const beacon = beacons[b]!;
    if (beacon.kind <= 0) continue;
    const base = b * 4;
    slot1Buf[base] = beacon.x;
    slot1Buf[base + 1] = beacon.y;
    slot1Buf[base + 2] = beacon.z;
    slot1Buf[base + 3] = beacon.kind + beacon.strength * 0.1;
  }
  return slot1Buf;
}

/** CPU smoke — minimum centre luma bound for CI. */
export function voxelSmokeCenterLuma(slot0: number[]): number {
  const sun = slot0[VOX_SLOT.sunPow] ?? 0.5;
  const fail = slot0[VOX_SLOT.failStrength] ?? 0;
  return Math.max(0.12, sun * 0.65 + 0.15 - fail * 0.05);
}
