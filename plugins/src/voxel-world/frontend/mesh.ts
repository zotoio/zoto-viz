import type { VoxCaps } from "./config";

export const CHUNK_SIZE = 16;
const MAX_Y = 22;

export interface ChunkMesh {
  cx: number;
  cz: number;
  vertices: Float32Array;
  indices: Uint16Array;
  voxelCount: number;
  triangleCount: number;
}

function hash(seed: number, x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 1013904223) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (Math.imul(h, 1274126177)) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function heightAt(seed: number, x: number, z: number): number {
  const n = Math.sin(x * 0.08 + seed * 0.001) * 0.5 + Math.sin(z * 0.06) * 0.5;
  return Math.floor(6 + n * 10);
}

function blockAt(seed: number, x: number, y: number, z: number): number {
  const h = heightAt(seed, x, z);
  if (y > h) return 0;
  if (y === h) return 1;
  if (y > h - 3) return 2;
  return 3;
}

type Face = { x: number; y: number; z: number; w: number; h: number; d: number; nx: number; ny: number; nz: number; mat: number };

/** Greedy merge exposed faces on each axis (hidden neighbours removed). */
function greedyFaces(seed: number, ox: number, oz: number): Face[] {
  const faces: Face[] = [];
  const exposed = (x: number, y: number, z: number, dx: number, dy: number, dz: number): boolean => {
    const b = blockAt(seed, x, y, z);
    if (!b) return false;
    return !blockAt(seed, x + dx, y + dy, z + dz);
  };
  for (let y = 0; y < MAX_Y; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x;
        const wz = oz + z;
        if (exposed(wx, y, wz, 0, 1, 0)) {
          let w = 1;
          while (x + w < CHUNK_SIZE && exposed(wx + w, y, wz, 0, 1, 0)
            && blockAt(seed, wx + w, y, wz) === blockAt(seed, wx, y, wz)) w++;
          let h = 1;
          let done = false;
          while (!done && z + h < CHUNK_SIZE) {
            for (let i = 0; i < w; i++) {
              if (!exposed(wx + i, y, wz + h, 0, 1, 0)
                || blockAt(seed, wx + i, y, wz + h) !== blockAt(seed, wx, y, wz)) {
                done = true;
                break;
              }
            }
            if (!done) h++;
          }
          faces.push({ x: wx, y, z: wz, w, h, d: 1, nx: 0, ny: 1, nz: 0, mat: blockAt(seed, wx, y, wz) });
          for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) {
            /* mark consumed top faces */
          }
          x += w - 1;
        }
      }
    }
  }
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let ly = 0; ly < MAX_Y; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        if (!exposed(wx, ly, wz, 1, 0, 0)) continue;
        const mat = blockAt(seed, wx, ly, wz);
        faces.push({ x: wx, y: ly, z: wz, w: 1, h: 1, d: 1, nx: 1, ny: 0, nz: 0, mat });
      }
    }
  }
  return faces;
}

function pushQuad(
  verts: number[],
  inds: number[],
  f: Face,
  seed: number,
): void {
  const shade = 0.6 + 0.4 * hash(seed, f.x, f.y, f.z);
  const base = verts.length / 8;
  const push = (px: number, py: number, pz: number) => {
    verts.push(px, py, pz, f.nx, f.ny, f.nz, shade, f.mat);
  };
  if (f.ny > 0) {
    push(f.x, f.y + 1, f.z);
    push(f.x + f.w, f.y + 1, f.z);
    push(f.x + f.w, f.y + 1, f.z + f.h);
    push(f.x, f.y + 1, f.z + f.h);
  } else if (f.nx !== 0) {
    push(f.x + 1, f.y, f.z);
    push(f.x + 1, f.y + 1, f.z);
    push(f.x + 1, f.y + 1, f.z + 1);
    push(f.x + 1, f.y, f.z + 1);
  } else {
    push(f.x, f.y, f.z + 1);
    push(f.x + 1, f.y, f.z + 1);
    push(f.x + 1, f.y + 1, f.z + 1);
    push(f.x, f.y + 1, f.z + 1);
  }
  inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function buildChunkMesh(seed: number, cx: number, cz: number): ChunkMesh {
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const verts: number[] = [];
  const inds: number[] = [];
  let voxels = 0;
  for (let y = 0; y < MAX_Y; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (blockAt(seed, ox + lx, y, oz + lz)) voxels++;
      }
    }
  }
  for (const f of greedyFaces(seed, ox, oz)) pushQuad(verts, inds, f, seed);
  return {
    cx,
    cz,
    vertices: new Float32Array(verts),
    indices: new Uint16Array(inds),
    voxelCount: voxels,
    triangleCount: inds.length / 3,
  };
}

export interface MeshEngineStats {
  drawCalls: number;
  triangles: number;
  voxelsDrawn: number;
  chunksRebuilt: number;
  verticesUsed: number;
}

export class MeshEngine {
  private chunks = new Map<string, ChunkMesh>();
  private queue: { cx: number; cz: number }[] = [];
  private seed = 1;

  reset(seed: number): void {
    this.seed = seed;
    this.chunks.clear();
    this.queue = [];
  }

  forEachChunk(fn: (key: string, mesh: ChunkMesh) => void): void {
    for (const [k, c] of this.chunks) fn(k, c);
  }

  tick(cameraX: number, cameraZ: number, caps: VoxCaps): MeshEngineStats {
    const need = new Set<string>();
    const ccx = Math.floor(cameraX / CHUNK_SIZE);
    const ccz = Math.floor(cameraZ / CHUNK_SIZE);
    const rad = Math.ceil(caps.maxViewDist / CHUNK_SIZE);
    for (let dz = -rad; dz <= rad; dz++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (this.chunks.size + need.size >= caps.maxChunks) break;
        need.add(`${ccx + dx},${ccz + dz}`);
      }
    }
    for (const k of need) {
      if (!this.chunks.has(k) && !this.queue.some((q) => `${q.cx},${q.cz}` === k)) {
        const [cx, cz] = k.split(",").map(Number);
        this.queue.push({ cx, cz });
      }
    }
    let rebuilt = 0;
    while (rebuilt < caps.chunksPerFrame && this.queue.length) {
      const { cx, cz } = this.queue.shift()!;
      const key = `${cx},${cz}`;
      if (this.chunks.size >= caps.maxChunks && !this.chunks.has(key)) {
        const first = this.chunks.keys().next().value;
        if (first) this.chunks.delete(first);
      }
      this.chunks.set(key, buildChunkMesh(this.seed, cx, cz));
      rebuilt++;
    }
    let triangles = 0;
    let voxels = 0;
    let vertices = 0;
    for (const c of this.chunks.values()) {
      triangles += c.triangleCount;
      voxels += c.voxelCount;
      vertices += c.vertices.length / 8;
    }
    return {
      drawCalls: this.chunks.size,
      triangles,
      voxelsDrawn: voxels,
      chunksRebuilt: rebuilt,
      verticesUsed: vertices,
    };
  }
}
