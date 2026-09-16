/** Gemma-authored far-field fragment. Host uniforms match the plugin sky contract plus uPhoto. */

import { SKY_LUMA_CAP_GLSL } from "../core/themes";

export const AGENT_SKY_MAX = 16_000;

const PREAMBLE = /* glsl */ `uniform float uTime;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform vec3 uAccent;
uniform vec3 uBg;
uniform sampler2D uPhoto;
in vec3 vDir;
out vec4 fragColor;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 5; i++) { a += w * noise(p); p *= 2.03; w *= 0.5; }
  return a;
}

${SKY_LUMA_CAP_GLSL}
`;

const HOST_MAIN = /* glsl */ `
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = color(dir, uTime);
  fragColor = vec4(capSkyLuma(col * uBright), uOpacity);
}
`;

const BANNED = [
  /\bsampler(?!2D\s+uPhoto\b)/i,
  /\btexture2D\b/,
  /\bwhile\s*\(/,
  /#\s*include\b/i,
  /\bgl_FragData\b/,
];

export function stripAgentSky(src: string): string {
  return src.replace(/^```(?:shader|glsl)?\s*/i, "").replace(/```$/i, "").trim();
}

/** Host-wrap a color() body or a void main fragment. */
export function wrapAgentSky(raw: string): { frag: string } | { error: string } {
  const src = stripAgentSky(raw);
  if (!src) return { error: "empty shader" };
  if (src.length > AGENT_SKY_MAX) return { error: "shader too long" };
  for (const re of BANNED) {
    if (re.test(src)) return { error: "shader uses a blocked construct" };
  }
  const body = src.replace(/#version[^\n]*\n?/g, "").replace(/\bprecision\s+\w+\s+float\s*;/g, "").trim();
  if (/\bvoid\s+main\s*\(/.test(body)) {
    return { frag: PREAMBLE + body };
  }
  if (!/\bvec3\s+colou?r\s*\(/.test(body)) {
    return { error: "shader needs vec3 color(vec3 dir, float t) or void main()" };
  }
  return { frag: PREAMBLE + body + HOST_MAIN };
}

/** Compile the wrapped fragment. null = ok. Happy-dom has no WebGL2, so tests skip. */
export function compileAgentSky(raw: string): string | null {
  const wrapped = wrapAgentSky(raw);
  if ("error" in wrapped) return wrapped.error;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) return null;
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  if (!sh) return "no shader";
  gl.shaderSource(sh, `#version 300 es\nprecision highp float;\n${wrapped.frag}`);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    return (gl.getShaderInfoLog(sh) || "compile failed").slice(0, 400);
  }
  return null;
}
