import { applyLiveBindings, resetLiveMarkers, type VoxLiveFrame } from "./bindings";
import { parseVoxConfig, voxOptionsToConfig, type VoxOptions } from "./config";
import { disposeGpuRenderer, drawChunks, gpuCounts, initGpuRenderer, uploadChunkMesh } from "./gl-renderer";
import { MeshEngine } from "./mesh";
import { packSlot0, packSlot1Mobs, voxelSmokeCenterLuma } from "./slots";
import { voxelCamera } from "./world";

let opts: VoxOptions = parseVoxConfig({});
let mesh = new MeshEngine();
let skips = 0;
let undoStack: VoxOptions[] = [];
let lastT = -1;
const FIXED_DT = 1 / 60;
let simAccum = 0;
let simSteps = 0;

export function setVoxConfig(cfg: Record<string, string>): void {
  opts = parseVoxConfig(cfg);
  mesh.reset(opts.seed);
}

export function voxOptions(): VoxOptions {
  return opts;
}

export function randomiseVoxConfig(rng = Math.random): { opts: VoxOptions; cfg: Record<string, string> } {
  undoStack.push({ ...opts, caps: { ...opts.caps }, live: { ...opts.live } });
  const cfg: Record<string, string> = {
    preset: "custom",
    seed: String(Math.floor(1 + rng() * 999_999)),
    biome: ["temperate", "boreal", "arid", "islands"][Math.floor(rng() * 4)]!,
    viewDist: String(Math.round(16 + rng() * 32)),
    timeOfDay: String(rng() * 24),
    weather: ["clear", "rain", "snow"][Math.floor(rng() * 3)]!,
    camera: ["fly", "walk", "orbit"][Math.floor(rng() * 3)]!,
    mobs: String(Math.floor(rng() * 7)),
    cap_maxChunks: "8",
    cap_maxViewDist: "48",
    cap_vertexBudget: "65536",
    cap_maxMobs: "6",
    cap_chunksPerFrame: "2",
  };
  opts = parseVoxConfig(cfg);
  mesh.reset(opts.seed);
  return { opts, cfg: voxOptionsToConfig(opts) };
}

export function undoVoxConfig(): { opts: VoxOptions; cfg: Record<string, string> } | null {
  const prev = undoStack.pop();
  if (!prev) return null;
  opts = prev;
  mesh.reset(opts.seed);
  return { opts, cfg: voxOptionsToConfig(opts) };
}

export function resetVoxConfig(): { opts: VoxOptions; cfg: Record<string, string> } {
  undoStack = [];
  opts = parseVoxConfig({ preset: "classic" });
  mesh.reset(opts.seed);
  return { opts, cfg: voxOptionsToConfig(opts) };
}

export function initVoxelWorld(): void {
  initGpuRenderer();
  mesh.reset(opts.seed);
}

export function disposeVoxelWorld(): void {
  disposeGpuRenderer();
  resetLiveMarkers();
  mesh = new MeshEngine();
  skips = 0;
  lastT = -1;
  simAccum = 0;
  simSteps = 0;
}

export interface VoxTickOut {
  slot0: number[];
  slot1: number[];
  bright: number;
  accent: [number, number, number];
  bg: [number, number, number];
  stats: ReturnType<MeshEngine["tick"]>;
}

export function tickVoxelWorld(frame: VoxLiveFrame, aspect = 1.6, dt: number = FIXED_DT): VoxTickOut {
  if (lastT >= 0 && frame.t <= lastT) skips++;
  lastT = frame.t;
  const cam = voxelCamera(frame.t, opts, opts.reducedMotion);
  const live = applyLiveBindings(frame, opts, cam);
  simAccum += dt;
  const maxCatchUp = 3;
  while (simAccum >= FIXED_DT && simSteps < maxCatchUp) {
    simAccum -= FIXED_DT;
    simSteps++;
  }
  if (simSteps >= maxCatchUp) simAccum = 0;
  simSteps = 0;
  const meshStats = mesh.tick(cam.x, cam.z, opts.caps);
  if (meshStats.verticesUsed > opts.caps.vertexBudget) {
    skips++;
  }
  mesh.forEachChunk((key, ch) => uploadChunkMesh(key, ch));
  drawChunks();
  const gpu = gpuCounts();
  const slot0 = packSlot0(frame.t, aspect, opts, live, meshStats, gpu.bytesAllocated, skips);
  const slot1 = packSlot1Mobs(frame.t, opts, cam, live);
  const bright = Math.max(0.55, 1.05 - live.failStrength * 0.35);
  const accent: [number, number, number] = live.failStrength > 0.35
    ? [0.95, 0.18, 0.22]
    : [0.42, 0.78, 0.38];
  const bg: [number, number, number] = [0.45, 0.62, 0.92];
  return { slot0, slot1, bright, accent, bg, stats: meshStats };
}

export function simulateFlyover(seconds: number, fps = 60): { maxRebuild: number; maxDraw: number; maxTri: number } {
  initVoxelWorld();
  let maxRebuild = 0;
  let maxDraw = 0;
  let maxTri = 0;
  for (let i = 0; i < seconds * fps; i++) {
    const out = tickVoxelWorld(
      {
        t: i / fps,
        packets: [],
        talkers: [],
        headlines: [],
        demo: true,
        sys: { cpu: 0.2, failed: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, udev: 0 },
      },
      1.6,
      1 / fps,
    );
    maxRebuild = Math.max(maxRebuild, out.stats.chunksRebuilt);
    maxDraw = Math.max(maxDraw, out.stats.drawCalls);
    maxTri = Math.max(maxTri, out.stats.triangles);
  }
  disposeVoxelWorld();
  return { maxRebuild, maxDraw, maxTri };
}

export { voxelSmokeCenterLuma };
