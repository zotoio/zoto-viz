/**
 * Isolated WebGL2 timing for fractal plugin sky.
 * Does not use the plugin iframe (srcdoc inline scripts can be blocked by CSP script-src 'self').
 * Used by fractal-zoom.test.ts to assert worst-case frame budget at render scale 1.0 (1280×800).
 */

import FRAG from "../../../plugins/src/fractal-zoom/sky/fragment.glsl?raw";
import { wrapPluginSky } from "../graph/backdrop";
import { VIZ_UBO } from "./viz-host";
import { packFractalDrive } from "../../../plugins/src/fractal-zoom/frontend/drive";
import { IDLE_POINTER } from "../../../plugins/src/fractal-zoom/frontend/interaction";
import type { FractalType } from "../../../plugins/src/fractal-zoom/frontend/options";
import { worstCaseFractalConfig } from "../../../plugins/src/fractal-zoom/frontend/config-mutation";

const VERT = `#version 300 es
out vec3 vDir;
void main() {
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vec2 pos = uv * 2.0 - 1.0;
  vDir = normalize(vec3(pos, -1.0));
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

/** Full monitor size for per-pixel cost; CI uses software GL — see benchFramebuffer(). */
export const FRACTAL_BENCH_FULL_W = 1280;
export const FRACTAL_BENCH_FULL_H = 800;

function benchFramebuffer(): { w: number; h: number } {
  const w = Number(process.env.FRACTAL_GPU_BENCH_W) || FRACTAL_BENCH_FULL_W;
  const h = Number(process.env.FRACTAL_GPU_BENCH_H) || FRACTAL_BENCH_FULL_H;
  return { w, h };
}

let lastBenchError = "";

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    lastBenchError = (gl.getShaderInfoLog(sh) || "shader compile failed").trim();
    return null;
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    lastBenchError = (gl.getProgramInfoLog(prog) || "link failed").trim();
    return null;
  }
  return prog;
}

export function fractalSkyBenchLastError(): string {
  return lastBenchError;
}

export interface FractalSkyBenchPayload {
  frag: string;
  slot0: number[];
  bright: number;
  accent: [number, number, number];
  bg: [number, number, number];
  slotUniform: string;
}

export function fractalSkyBenchPayload(fractalType: FractalType): FractalSkyBenchPayload | null {
  const wrapped = wrapPluginSky(FRAG);
  if ("error" in wrapped) {
    lastBenchError = wrapped.error;
    return null;
  }
  const cfg = worstCaseFractalConfig(fractalType);
  const { w, h } = benchFramebuffer();
  const drive = packFractalDrive(1.25, 1 / 60, 0.35, w / h, cfg, IDLE_POINTER);
  return {
    frag: wrapped.frag,
    slot0: drive.slot0,
    bright: drive.bright,
    accent: drive.accent,
    bg: drive.bg,
    slotUniform: VIZ_UBO.threeUniform,
  };
}

/** Runs inside a real browser context (Playwright or DOM). */
export function benchFractalSkyOnGl(
  gl: WebGL2RenderingContext,
  payload: FractalSkyBenchPayload,
  warmup = 2,
  samples = 4,
): number | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${payload.frag}`);
  if (!vs || !fs) return null;
  const prog = linkProgram(gl, vs, fs);
  if (!prog) return null;

  gl.useProgram(prog);
  const slotsLoc = gl.getUniformLocation(prog, `${payload.slotUniform}[0]`)
    ?? gl.getUniformLocation(prog, payload.slotUniform);
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uOpacity = gl.getUniformLocation(prog, "uOpacity");
  const uBright = gl.getUniformLocation(prog, "uBright");
  const uAudio = gl.getUniformLocation(prog, "uAudio");
  const uAccent = gl.getUniformLocation(prog, "uAccent");
  const uBg = gl.getUniformLocation(prog, "uBg");

  const slotVec4 = new Float32Array(VIZ_UBO.totalVec4s * 4);
  for (let i = 0; i < payload.slot0.length; i++) {
    slotVec4[i] = payload.slot0[i] ?? 0;
  }

  gl.uniform4fv(slotsLoc, slotVec4);
  gl.uniform1f(uTime, 1.25);
  gl.uniform1f(uOpacity, 1);
  gl.uniform1f(uBright, payload.bright);
  gl.uniform1f(uAudio, 0.35);
  gl.uniform3f(uAccent, payload.accent[0], payload.accent[1], payload.accent[2]);
  gl.uniform3f(uBg, payload.bg[0], payload.bg[1], payload.bg[2]);

  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, bw, bh);

  const syncBuf = new Uint8Array(4);
  const draw = () => {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  for (let i = 0; i < warmup; i++) {
    draw();
    gl.finish();
  }
  let max = 0;
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    draw();
    gl.finish();
    max = Math.max(max, performance.now() - t0);
  }
  gl.readPixels(bw / 2, bh / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);

  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return max;
}

/** Max GPU frame time (ms) for one fullscreen draw at render scale 1.0 (happy-dom when WebGL2 exists). */
export function benchFractalSkyFrameMs(
  fractalType: FractalType,
  warmup = 2,
  samples = 4,
): number | null {
  lastBenchError = "";
  if (typeof document === "undefined") {
    lastBenchError = "no document";
    return null;
  }
  const payload = fractalSkyBenchPayload(fractalType);
  if (!payload) return null;

  const canvas = document.createElement("canvas");
  const { w: bw, h: bh } = benchFramebuffer();
  canvas.width = bw;
  canvas.height = bh;
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
  if (!gl) {
    lastBenchError = "webgl2 context unavailable";
    return null;
  }
  return benchFractalSkyOnGl(gl, payload, warmup, samples);
}

/** Chromium WebGL2 bench — avoids plugin sandbox CSP (script-src 'self' vs srcdoc inline). */
export async function benchFractalSkyFrameMsChromium(
  fractalType: FractalType,
): Promise<number | null> {
  lastBenchError = "";
  const payload = fractalSkyBenchPayload(fractalType);
  if (!payload) return null;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: ["--enable-webgl", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage();
    const ms = await page.evaluate(
      ({ payload: p, vert, w, h, warmup, samples }) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
        if (!gl) return { ms: null as number | null, err: "webgl2" };

        const compile = (type: number, src: string) => {
          const sh = gl.createShader(type);
          if (!sh) return null;
          gl.shaderSource(sh, src);
          gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            return { err: (gl.getShaderInfoLog(sh) || "fs").trim() };
          }
          return sh;
        };
        const vs = compile(gl.VERTEX_SHADER, vert);
        if (!vs || "err" in vs) return { ms: null, err: "vs" };
        const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${p.frag}`);
        if (!fs || "err" in fs) return { ms: null, err: "fs" };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs as WebGLShader);
        gl.attachShader(prog, fs as WebGLShader);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          return { ms: null, err: (gl.getProgramInfoLog(prog) || "link").trim() };
        }
        gl.useProgram(prog);
        const slotsLoc = gl.getUniformLocation(prog, `${p.slotUniform}[0]`)
          ?? gl.getUniformLocation(prog, p.slotUniform);
        const slotVec4 = new Float32Array(128 * 4);
        for (let i = 0; i < p.slot0.length; i++) slotVec4[i] = p.slot0[i] ?? 0;
        gl.uniform4fv(slotsLoc, slotVec4);
        gl.uniform1f(gl.getUniformLocation(prog, "uTime"), 1.25);
        gl.uniform1f(gl.getUniformLocation(prog, "uOpacity"), 1);
        gl.uniform1f(gl.getUniformLocation(prog, "uBright"), p.bright);
        gl.uniform1f(gl.getUniformLocation(prog, "uAudio"), 0.35);
        gl.uniform3f(gl.getUniformLocation(prog, "uAccent"), p.accent[0], p.accent[1], p.accent[2]);
        gl.uniform3f(gl.getUniformLocation(prog, "uBg"), p.bg[0], p.bg[1], p.bg[2]);
        const fbo = gl.createFramebuffer();
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.viewport(0, 0, w, h);
        const syncBuf = new Uint8Array(4);
        const draw = () => { gl.drawArrays(gl.TRIANGLES, 0, 3); };
        for (let i = 0; i < warmup; i++) { draw(); gl.finish(); }
        let max = 0;
        for (let i = 0; i < samples; i++) {
          const t0 = performance.now();
          draw();
          gl.finish();
          max = Math.max(max, performance.now() - t0);
        }
        gl.readPixels(w / 2, h / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);
        return { ms: max, err: "" };
      },
      { payload, vert: VERT, w: benchFramebuffer().w, h: benchFramebuffer().h, warmup: 2, samples: 4 },
    );
    await browser.close();
    if (ms.ms === null) {
      lastBenchError = ms.err || "chromium bench failed";
      return null;
    }
    return ms.ms;
  } catch (e) {
    lastBenchError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

/** Prefer DOM WebGL2, then Chromium (isolated shader; not the plugin iframe). */
export async function benchFractalSkyFrameMsAtScale1(
  fractalType: FractalType,
): Promise<number | null> {
  const dom = benchFractalSkyFrameMs(fractalType);
  if (dom !== null) return dom;
  return benchFractalSkyFrameMsChromium(fractalType);
}

/** One Chromium launch for all fractal types (CI-friendly). */
export async function benchFractalSkyWorstCaseAllTypes(
  types: readonly FractalType[],
): Promise<Map<FractalType, number> | null> {
  const payloads: { type: FractalType; payload: FractalSkyBenchPayload }[] = [];
  for (const type of types) {
    const payload = fractalSkyBenchPayload(type);
    if (!payload) return null;
    payloads.push({ type, payload });
  }
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      args: ["--enable-webgl", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage();
    const out = await page.evaluate(
      ({ items, vert, w, h }) => {
        const results: Record<string, number> = {};
        for (const { type, payload: p } of items) {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
          if (!gl) return { err: "webgl2", results };
          const compile = (tp: number, src: string) => {
            const sh = gl.createShader(tp);
            if (!sh) return null;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
          };
          const vs = compile(gl.VERTEX_SHADER, vert);
          const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${p.frag}`);
          if (!vs || !fs) return { err: "compile", results };
          const prog = gl.createProgram()!;
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.linkProgram(prog);
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { err: "link", results };
          gl.useProgram(prog);
          const slotsLoc = gl.getUniformLocation(prog, `${p.slotUniform}[0]`)
            ?? gl.getUniformLocation(prog, p.slotUniform);
          const slotVec4 = new Float32Array(128 * 4);
          for (let i = 0; i < p.slot0.length; i++) slotVec4[i] = p.slot0[i] ?? 0;
          gl.uniform4fv(slotsLoc, slotVec4);
          gl.uniform1f(gl.getUniformLocation(prog, "uTime"), 1.25);
          gl.uniform1f(gl.getUniformLocation(prog, "uOpacity"), 1);
          gl.uniform1f(gl.getUniformLocation(prog, "uBright"), p.bright);
          gl.uniform1f(gl.getUniformLocation(prog, "uAudio"), 0.35);
          gl.uniform3f(gl.getUniformLocation(prog, "uAccent"), p.accent[0], p.accent[1], p.accent[2]);
          gl.uniform3f(gl.getUniformLocation(prog, "uBg"), p.bg[0], p.bg[1], p.bg[2]);
          const fbo = gl.createFramebuffer();
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          gl.viewport(0, 0, w, h);
          const syncBuf = new Uint8Array(4);
          const draw = () => { gl.drawArrays(gl.TRIANGLES, 0, 3); };
          for (let i = 0; i < 2; i++) { draw(); gl.finish(); }
          let max = 0;
          for (let i = 0; i < 4; i++) {
            const t0 = performance.now();
            draw();
            gl.finish();
            max = Math.max(max, performance.now() - t0);
          }
          gl.readPixels(w / 2, h / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf);
          results[type] = max;
        }
        return { err: "", results };
      },
      { items: payloads, vert: VERT, w: benchFramebuffer().w, h: benchFramebuffer().h },
    );
    await browser.close();
    if (out.err) {
      lastBenchError = out.err;
      return null;
    }
    const map = new Map<FractalType, number>();
    for (const type of types) {
      const ms = out.results[type];
      if (ms === undefined) return null;
      map.set(type, ms);
    }
    return map;
  } catch (e) {
    lastBenchError = e instanceof Error ? e.message : String(e);
    return null;
  }
}
