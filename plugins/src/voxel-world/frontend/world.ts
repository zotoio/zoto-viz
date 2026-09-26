/** Camera and terrain helpers — must match `sky/fragment.glsl` `terrainH`. */

import type { VoxBiome, VoxOptions } from "./config";

function biomeMix(b: VoxBiome): number {
  return { temperate: 0.25, boreal: 0.55, arid: 0.75, islands: 0.45 }[b];
}

function hu(x: number, y: number, z: number): number {
  let h = ((x | 0) * 1597334677) ^ ((y | 0) * 3812015801) ^ ((z | 0) * 2798796415);
  h >>>= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function hf(x: number, y: number, z: number): number {
  return (hu(x, y, z) >>> 8) / 16777216;
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hf(ix, iz, 0);
  const b = hf(ix + 1, iz, 0);
  const c = hf(ix, iz + 1, 0);
  const d = hf(ix + 1, iz + 1, 0);
  return (1 - v) * ((1 - u) * a + u * b) + v * ((1 - u) * c + u * d);
}

function fbm(x: number, z: number): number {
  let v = 0;
  let a = 0.5;
  let px = x;
  let pz = z;
  for (let i = 0; i < 4; i++) {
    v += a * valueNoise(px, pz);
    px *= 2.03;
    pz *= 2.03;
    a *= 0.5;
  }
  return v;
}

export function terrainHeight(x: number, z: number, seed: number, biome: VoxBiome): number {
  const s = seed * 0.001;
  const qx = x * 0.07 + s;
  const qz = z * 0.07 + s * 2;
  const n = fbm(qx, qz) * 2 - 1;
  let h = 6 + n * 10;
  const mix = biomeMix(biome);
  h += mix * 4;
  if (mix > 0.65) h = 5 + n * 5;
  if (mix > 0.35 && mix < 0.55) {
    const island = Math.exp(-0.0025 * (x * x + z * z));
    h = 2 + island * 14;
  }
  return h;
}

/** Village pad for islands / archipelago — highest ground near origin. */
export function villageAnchor(seed: number, biome: VoxBiome): { x: number; z: number } {
  if (biome !== "islands") return { x: 0, z: 0 };
  let bestX = 0;
  let bestZ = 0;
  let bestH = terrainHeight(0, 0, seed, biome);
  for (let i = 0; i < 64; i++) {
    const ang = i * 0.55;
    const r = i * 0.25;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const h = terrainHeight(x, z, seed, biome);
    if (h > bestH) {
      bestH = h;
      bestX = x;
      bestZ = z;
    }
  }
  return { x: bestX, z: bestZ };
}

export function sunDir(dayFrac: number): [number, number, number] {
  const ang = (dayFrac - 0.25) * Math.PI * 2;
  const y = Math.sin(ang);
  const xz = Math.cos(ang);
  return [xz * 0.65, y, xz * 0.35];
}

export function voxelCamera(
  t: number,
  o: VoxOptions,
  reducedMotion = false,
): { x: number; y: number; z: number; yaw: number; pitch: number } {
  const speed = reducedMotion ? o.cameraSpeed * 0.15 : o.cameraSpeed;
  const phase = t * speed * 0.12;
  const village = villageAnchor(o.seed, o.biome);
  const { x: villageX, z: villageZ } = village;
  if (o.camera === "orbit") {
    const r = reducedMotion ? 22 : 28 + Math.sin(phase * 0.3) * 4;
    const ang = reducedMotion ? 0.6 : phase * 0.35;
    const x = villageX + Math.cos(ang) * r;
    const z = villageZ + Math.sin(ang) * r;
    const y = terrainHeight(x, z, o.seed, o.biome) + 10 + Math.sin(phase * 0.5) * 2;
    const yaw = Math.atan2(villageX - x, villageZ - z);
    const pitch = -0.18 + Math.sin(phase * 0.2) * 0.04;
    return { x, y, z, yaw, pitch };
  }
  if (o.camera === "walk") {
    const path = phase * 6;
    const x = villageX + Math.sin(path * 0.15) * 40 + Math.cos(path * 0.07) * 20;
    const z = villageZ + path * 2.2 - 30;
    const ground = terrainHeight(x, z, o.seed, o.biome);
    const y = ground + 1.62 + Math.sin(path * 2) * 0.04;
    const yaw = Math.atan2(Math.cos(path * 0.15) * 6, 2.2);
    const pitch = -0.05 + Math.sin(path) * 0.02;
    return { x, y, z, yaw, pitch };
  }
  const x = villageX + Math.sin(phase * 0.4) * 55 + Math.sin(phase * 0.11) * 20;
  const z = villageZ - phase * 14;
  const y = terrainHeight(x, z, o.seed, o.biome) + 14 + Math.sin(phase * 0.25) * 3;
  const yaw = Math.atan2(-Math.cos(phase * 0.4) * 20, 14);
  const pitch = -0.28 + Math.sin(phase * 0.18) * 0.06;
  return { x, y, z, yaw, pitch };
}
