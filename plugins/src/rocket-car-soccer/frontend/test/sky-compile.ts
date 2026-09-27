/** Minimal plugin sky wrap/compile for pack tests (no web/src imports). */

const PLUGIN_SKY_MAX = 128_000;
const PLUGIN_ALLOWED = new Set(["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"]);
const VIZ_UBO_GLSL = "uniform vec4 zotoVizSlots[128];";

const PLUGIN_UNIFORM_RE =
  /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|vec[234]|int|uint|bool|mat[234]|sampler(?:2D|3D|Cube))\s+(\w+)\s*;/g;

export function pluginShaderError(src: string): string | null {
  if (!src.trim()) return "empty shader";
  if (src.length > PLUGIN_SKY_MAX) return "shader too long";
  if (/#\s*include\b/i.test(src) || /\bimport\s/.test(src)) return "shader includes are not allowed";
  if (/\bbinding\s*=/.test(src) || /\blayout\s*\(\s*std140/.test(src)) {
    return "UBO layout/binding qualifiers are not portable; use zotoVizSlots";
  }
  const names = new Set<string>();
  const re = new RegExp(PLUGIN_UNIFORM_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.add(m[1]!);
  for (const n of names) {
    if (!PLUGIN_ALLOWED.has(n)) return `non-whitelisted uniform ${n}`;
  }
  if (!/\bvoid\s+main\s*\(/.test(src)) return "shader needs void main()";
  return null;
}

export function wrapPluginSky(raw: string): { frag: string } | { error: string } {
  const err = pluginShaderError(raw);
  if (err) return { error: err };
  const body = raw.replace(/#version[^\n]*\n?/g, "").replace(/\bprecision\s+\w+\s+float\s*;/g, "").trim();
  const stripped = body
    .replace(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|vec[234])\s+(?:uTime|uOpacity|uBright|uAudio|uAccent|uBg)\s*;/g, "")
    .replace(/\bin\s+vec3\s+vDir\s*;/g, "")
    .replace(/\bout\s+vec4\s+fragColor\s*;/g, "")
    .trim();
  const preamble = `${VIZ_UBO_GLSL}
uniform float uTime;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform vec3 uAccent;
uniform vec3 uBg;
in vec3 vDir;
out vec4 fragColor;

`;
  return { frag: preamble + stripped };
}

export function probePluginSkyCompile(frag: string): string | null {
  if (typeof document === "undefined") return null;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!gl) return null;
    const sh = gl.createShader(gl.FRAGMENT_SHADER);
    if (!sh) return null;
    gl.shaderSource(sh, `#version 300 es\nprecision highp float;\n${frag}`);
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
    return (gl.getShaderInfoLog(sh) || "compile failed").replace(/\0/g, "").trim() || "compile failed";
  } catch {
    return null;
  } finally {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
