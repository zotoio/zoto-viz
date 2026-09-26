/**
 * One-shot WebGL2 draw for fractal sky smoke tests (no frame-time measurement).
 * Skips when WebGL2 is unavailable (e.g. some DOM environments).
 */

import FRAG from "../../../plugins/src/fractal-zoom/sky/fragment.glsl?raw";
import { wrapPluginSky } from "../graph/backdrop";
import { VIZ_UBO } from "./viz-host";
import { packFractalDrive, resetFractalDrive } from "../../../plugins/src/fractal-zoom/frontend/drive";
import { fractalPresetConfig } from "../../../plugins/src/fractal-zoom/frontend/config-mutation";
import { IDLE_POINTER } from "../../../plugins/src/fractal-zoom/frontend/interaction";

const VERT = `#version 300 es
out vec3 vDir;
void main() {
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vec2 pos = uv * 2.0 - 1.0;
  vDir = normalize(vec3(pos, -1.0));
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

export interface FractalSkySmokeResult {
  ok: boolean;
  skipped: boolean;
  compileError: string | null;
  rgba: [number, number, number, number] | null;
}

/** Default preset (bulb-classic) at 320×200 — software GL is fine. */
export function smokeFractalDefaultPresetSky(): FractalSkySmokeResult {
  if (typeof document === "undefined") {
    return { ok: false, skipped: true, compileError: "no document", rgba: null };
  }
  const wrapped = wrapPluginSky(FRAG);
  if ("error" in wrapped) {
    return { ok: false, skipped: false, compileError: wrapped.error, rgba: null };
  }

  const w = 320;
  const h = 200;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
  if (!gl) {
    return { ok: false, skipped: true, compileError: null, rgba: null };
  }

  const compile = (type: number, src: string): WebGLShader | string => {
    const sh = gl.createShader(type);
    if (!sh) return "no shader";
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      return (gl.getShaderInfoLog(sh) || "compile failed").trim();
    }
    return sh;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  if (typeof vs === "string") return { ok: false, skipped: false, compileError: vs, rgba: null };
  const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${wrapped.frag}`);
  if (typeof fs === "string") return { ok: false, skipped: false, compileError: fs, rgba: null };

  const prog = gl.createProgram();
  if (!prog) return { ok: false, skipped: false, compileError: "no program", rgba: null };
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return { ok: false, skipped: false, compileError: (gl.getProgramInfoLog(prog) || "link failed").trim(), rgba: null };
  }

  resetFractalDrive();
  const cfg = { preset: "bulb-classic", ...fractalPresetConfig("bulb-classic") };
  const drive = packFractalDrive(0.5, 1 / 60, 0.1, w / h, cfg, IDLE_POINTER);
  const slotVec4 = new Float32Array(VIZ_UBO.totalVec4s * 4);
  for (let i = 0; i < drive.slot0.length; i++) slotVec4[i] = drive.slot0[i] ?? 0;

  gl.useProgram(prog);
  const slotsLoc = gl.getUniformLocation(prog, `${VIZ_UBO.threeUniform}[0]`)
    ?? gl.getUniformLocation(prog, VIZ_UBO.threeUniform);
  gl.uniform4fv(slotsLoc, slotVec4);
  gl.uniform1f(gl.getUniformLocation(prog, "uTime"), 0.5);
  gl.uniform1f(gl.getUniformLocation(prog, "uOpacity"), 1);
  gl.uniform1f(gl.getUniformLocation(prog, "uBright"), drive.bright);
  gl.uniform1f(gl.getUniformLocation(prog, "uAudio"), 0.1);
  gl.uniform3f(gl.getUniformLocation(prog, "uAccent"), drive.accent[0], drive.accent[1], drive.accent[2]);
  gl.uniform3f(gl.getUniformLocation(prog, "uBg"), drive.bg[0], drive.bg[1], drive.bg[2]);

  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();

  const px = new Uint8Array(4);
  gl.readPixels(w / 2, h / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const rgba: [number, number, number, number] = [px[0]!, px[1]!, px[2]!, px[3]!];
  const lum = rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
  const nearBlack = lum < 12 && rgba[0] < 15 && rgba[1] < 15 && rgba[2] < 25;
  return { ok: !nearBlack, skipped: false, compileError: null, rgba };
}
