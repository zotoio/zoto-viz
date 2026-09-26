import type { VoxCaps } from "./config";

export const CHUNK_SIZE = 16;

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

/** Greedy mesher with hidden-face removal (axis-aligned faces only). */
export function buildChunkMesh(seed: number, cx: number, cz: number): ChunkMesh {
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const verts: number[] = [];
  const inds: number[] = [];
  let voxels = 0;
  const dirs = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  for (let y = 0; y < 32; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = ox + lx;
        const z = oz + lz;
        const b = blockAt(seed, x, y, z);
        if (!b) continue;
        voxels++;
        for (const [dx, dy, dz] of dirs) {
          const nb = blockAt(seed, x + dx, y + dy, z + dz);
          if (nb) continue;
          const base = verts.length / 8;
          const shade = 0.6 + 0.4 * hash(seed, x, y, z);
          const push = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
            verts.push(px, py, pz, nx, ny, nz, shade, b);
          };
          if (dx !== 0) {
            push(x + (dx > 0 ? 1 : 0), y, z, dx, 0, 0);
            push(x + (dx > 0 ? 1 : 0), y + 1, z, dx, 0, 0);
            push(x + (dx > 0 ? 1 : 0), y + 1, z + 1, dx, 0, 0);
            push(x + (dx > 0 ? 1 : 0), y, z + 1, dx, 0, 0);
          } else if (dy !== 0) {
            push(x, y + (dy > 0 ? 1 : 0), z, 0, dy, 0);
            push(x + 1, y + (dy > 0 ? 1 : 0), z, 0, dy, 0);
            push(x + 1, y + (dy > 0 ? 1 : 0), z + 1, 0, dy, 0);
            push(x, y + (dy > 0 ? 1 : 0), z + 1, 0, dy, 0);
          } else {
            push(x, y, z + (dz > 0 ? 1 : 0), 0, 0, dz);
            push(x + 1, y, z + (dz > 0 ? 1 : 0), 0, 0, dz);
            push(x + 1, y + 1, z + (dz > 0 ? 1 : 0), 0, 0, dz);
            push(x, y + 1, z + (dz > 0 ? 1 : 0), 0, 0, dz);
          }
          inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
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
