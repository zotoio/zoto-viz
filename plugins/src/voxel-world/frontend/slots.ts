import type { VoxLiveState } from "./bindings";
import type { VoxOptions } from "./config";
import type { MeshEngineStats } from "./mesh";
import { sunDir, voxelCamera } from "./world";

export const VOX_SLOT = {
  mark: 0,
  camX: 1, camY: 2, camZ: 3, yaw: 4, pitch: 5, aspect: 6, day: 7,
  seed: 8, biome: 9, viewDist: 10, fog: 11, weather: 12, camMode: 13, camSpeed: 14, flags: 15,
  sunX: 16, sunY: 17, sunZ: 18, sunPow: 19, torch: 20, palette: 21, texStyle: 22,
  failTint: 23, weatherMix: 24, demo: 25, metric: 26, skips: 27,
  drawCalls: 28, triangles: 29, voxels: 30, gpuBytes: 31,
} as const;

export const VOX_SLOT0_FLOATS = 32;

function biomeMix(b: VoxOptions["biome"]): number {
  return { temperate: 0.25, boreal: 0.55, arid: 0.75, islands: 0.45 }[b];
}

function weatherId(w: VoxOptions["weather"]): number {
  return { clear: 0, rain: 1, snow: 2 }[w];
}

function camId(c: VoxOptions["camera"]): number {
  return { fly: 0, walk: 1, orbit: 2 }[c];
}

export function packSlot0(
  t: number,
  aspect: number,
  o: VoxOptions,
  live: VoxLiveState,
  mesh: MeshEngineStats,
  gpuBytes: number,
  skips: number,
): number[] {
  const dayHours = (o.timeOfDay + (o.cycleSpeed / 60) * t) % 24;
  const dayFrac = dayHours / 24;
  const cam = voxelCamera(t, o);
  const [sx, sy, sz] = sunDir(dayFrac);
  const sunPow = Math.min(1, Math.max(0.08, sy * 0.85 + 0.12));
  const torch = dayFrac < 0.28 || dayFrac > 0.72 ? 0.85 : 0.1 + live.torchPulse * 0.6;
  const slot = new Array(VOX_SLOT0_FLOATS).fill(0);
  slot[VOX_SLOT.mark] = 1;
  slot[VOX_SLOT.camX] = cam.x;
  slot[VOX_SLOT.camY] = cam.y;
  slot[VOX_SLOT.camZ] = cam.z;
  slot[VOX_SLOT.yaw] = cam.yaw;
  slot[VOX_SLOT.pitch] = cam.pitch;
  slot[VOX_SLOT.aspect] = aspect;
  slot[VOX_SLOT.day] = dayFrac;
  slot[VOX_SLOT.seed] = o.seed;
  slot[VOX_SLOT.biome] = biomeMix(o.biome);
  slot[VOX_SLOT.viewDist] = o.viewDist;
  slot[VOX_SLOT.fog] = o.fog;
  slot[VOX_SLOT.weather] = weatherId(o.weather);
  slot[VOX_SLOT.camMode] = camId(o.camera);
  slot[VOX_SLOT.camSpeed] = o.cameraSpeed;
  slot[VOX_SLOT.flags] = (o.clouds ? 1 : 0) | (o.reducedMotion ? 2 : 0);
  slot[VOX_SLOT.sunX] = sx;
  slot[VOX_SLOT.sunY] = sy;
  slot[VOX_SLOT.sunZ] = sz;
  slot[VOX_SLOT.sunPow] = sunPow * (1 - live.failTint * 0.65);
  slot[VOX_SLOT.torch] = torch;
  slot[VOX_SLOT.palette] = { verdant: 0, sunset: 1, alpine: 2, candy: 3 }[o.palette];
  slot[VOX_SLOT.texStyle] = { crisp: 0, smooth: 1, painterly: 2 }[o.textureStyle];
  slot[VOX_SLOT.failTint] = live.failTint;
  slot[VOX_SLOT.weatherMix] = live.weatherMix;
  slot[VOX_SLOT.demo] = live.demo ? 1 : 0;
  slot[VOX_SLOT.metric] = live.metric;
  slot[VOX_SLOT.skips] = skips;
  slot[VOX_SLOT.drawCalls] = mesh.drawCalls;
  slot[VOX_SLOT.triangles] = mesh.triangles;
  slot[VOX_SLOT.voxels] = mesh.voxelsDrawn;
  slot[VOX_SLOT.gpuBytes] = gpuBytes;
  return slot;
}

export function packSlot1Mobs(t: number, o: VoxOptions, cam: { x: number; z: number }): number[] {
  const out = new Array(24).fill(0);
  const n = Math.min(6, Math.max(0, o.mobs));
  for (let i = 0; i < n; i++) {
    const h = ((o.seed + i * 17) % 97) / 97;
    const ang = t * (0.3 + h) + i * 2;
    const x = cam.x + Math.cos(ang) * (5 + h * 6);
    const z = cam.z + Math.sin(ang) * (5 + h * 6);
    const o4 = i * 4;
    out[o4] = x;
    out[o4 + 1] = 7;
    out[o4 + 2] = z;
    out[o4 + 3] = 0.5;
  }
  return out;
}

/** CPU smoke — minimum centre luma bound for CI. */
export function voxelSmokeCenterLuma(slot0: number[]): number {
  const sun = slot0[VOX_SLOT.sunPow] ?? 0.5;
  const fail = slot0[VOX_SLOT.failTint] ?? 0;
  return Math.max(0.12, sun * 0.65 + 0.15 - fail * 0.05);
}
