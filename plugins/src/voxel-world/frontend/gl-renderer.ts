import type { ChunkMesh } from "./mesh";

export interface GpuCounts {
  contexts: number;
  programs: number;
  textures: number;
  buffers: number;
  rafCallbacks: number;
  workers: number;
  bytesAllocated: number;
}

const counts: GpuCounts = {
  contexts: 0,
  programs: 0,
  textures: 0,
  buffers: 0,
  rafCallbacks: 0,
  workers: 0,
  bytesAllocated: 0,
};

let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let atlas: WebGLTexture | null = null;
const chunkBuffers = new Map<string, { vbo: WebGLBuffer; ibo: WebGLBuffer; tris: number }>();

function trackBytes(n: number): void {
  counts.bytesAllocated += n;
}

export function gpuCounts(): GpuCounts {
  return { ...counts };
}

export function initGpuRenderer(): void {
  if (gl) return;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  gl = canvas.getContext("webgl2", { antialias: false, depth: true });
  if (!gl) return;
  counts.contexts = 1;
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, `#version 300 es\nin vec3 aPos; void main(){ gl_Position=vec4(aPos,1.); }`);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, `#version 300 es\nprecision mediump float; out vec4 c; void main(){ c=vec4(0.2,0.5,0.3,1.); }`);
  gl.compileShader(fs);
  program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  counts.programs = 1;
  atlas = gl.createTexture()!;
  counts.textures = 1;
  const pix = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < pix.length; i += 4) {
    pix[i] = 90 + (i % 37);
    pix[i + 1] = 120 + (i % 53);
    pix[i + 2] = 70 + (i % 29);
    pix[i + 3] = 255;
  }
  trackBytes(pix.byteLength);
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, pix);
}

export function uploadChunkMesh(key: string, mesh: ChunkMesh): void {
  if (!gl) return;
  let rec = chunkBuffers.get(key);
  if (!rec) {
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;
    counts.buffers += 2;
    rec = { vbo, ibo, tris: 0 };
    chunkBuffers.set(key, rec);
  }
  trackBytes(mesh.vertices.byteLength + mesh.indices.byteLength);
  gl.bindBuffer(gl.ARRAY_BUFFER, rec.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rec.ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
  rec.tris = mesh.triangleCount;
}

/** One draw call per chunk (logical; host sky still paints the stage). */
export function drawChunks(): number {
  if (!gl || !program) return 0;
  gl.useProgram(program);
  let draws = 0;
  for (const rec of chunkBuffers.values()) {
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rec.ibo);
    gl.drawElements(gl.TRIANGLES, rec.tris, gl.UNSIGNED_SHORT, 0);
    draws++;
  }
  return draws;
}

export function disposeGpuRenderer(): void {
  if (gl) {
    for (const rec of chunkBuffers.values()) {
      gl.deleteBuffer(rec.vbo);
      gl.deleteBuffer(rec.ibo);
    }
    chunkBuffers.clear();
    if (atlas) gl.deleteTexture(atlas);
    if (program) gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  gl = null;
  program = null;
  atlas = null;
  counts.contexts = 0;
  counts.programs = 0;
  counts.textures = 0;
  counts.buffers = 0;
  counts.bytesAllocated = 0;
}
