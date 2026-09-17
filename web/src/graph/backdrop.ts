import * as THREE from "three";
import { PLUGIN_SKY_UNIFORMS } from "../plugins/plugin-sky-uniforms";
import { VIZ_UBO, VIZ_UBO_GLSL } from "../plugins/viz-host";
import { liveCam } from "../camera/livecam";
import { SKY_LUMA_CAP, SKY_LUMA_CAP_GLSL } from "../core/themes";
import { currentSkyRecipe, DEFAULT_SKY_RECIPE, cloneSkyRecipe, lerpSkyRecipe, skyRecipeKey, type SkyRecipe } from "./sky-ai";
import { wrapAgentSky } from "./sky-agent";

/**
 * Far-field sky behind the graph: a huge inward sphere around the origin so orbiting the network
 * reads as flying through space / rain / a fractal, while the device cloud stays in the foreground.
 */

export type BackdropKind =
  | "none" | "fractal" | "space" | "matrix" | "live"
  | "aurora" | "rain" | "ocean" | "fire" | "warp" | "clouds" | "circuit" | "plasma" | "lattice"
  | "dynamic" | "custom" | "plugin";

export const BACKDROP_OPTIONS: { value: BackdropKind; label: string; hint: string }[] = [
  { value: "none", label: "none", hint: "plain fog" },
  { value: "fractal", label: "fractal", hint: "slow Julia set" },
  { value: "space", label: "space", hint: "starfield" },
  { value: "matrix", label: "matrix", hint: "falling code" },
  { value: "aurora", label: "aurora", hint: "polar curtains" },
  { value: "rain", label: "rain", hint: "falling streaks" },
  { value: "ocean", label: "ocean", hint: "underwater caustics" },
  { value: "fire", label: "fire", hint: "rising embers" },
  { value: "warp", label: "warp", hint: "star-streak tunnel" },
  { value: "clouds", label: "clouds", hint: "soft fbm overcast" },
  { value: "circuit", label: "circuit", hint: "trace lattice" },
  { value: "plasma", label: "plasma", hint: "interference wash" },
  { value: "lattice", label: "lattice", hint: "night grid" },
  { value: "dynamic", label: "AI Dynamic", hint: "Gemma rebuilds this sky on a timer" },
  { value: "custom", label: "agent shader", hint: "GLSL the local agent wrote into the model-named profile" },
  { value: "plugin", label: "plugin shader", hint: "GLSL shipped in the selected plugin zip" },
  { value: "live", label: "live", hint: "this machine's camera" },
];

/** Skies the dream / randomize pool picks from (not none / not Gemma). */
export const CYCLE_SKIES: BackdropKind[] = [
  "fractal", "space", "matrix", "aurora", "rain", "ocean", "fire", "warp", "clouds", "circuit", "plasma", "lattice", "live",
];

/** Cycle pool minus live when the camera was denied or is missing. */
export function cycleSkyPool(): BackdropKind[] {
  if (liveCam.blocked || liveCam.camPolicy === "off") return CYCLE_SKIES.filter((k) => k !== "live");
  return CYCLE_SKIES;
}

const VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uMode;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform vec3 uAccent;
uniform vec3 uBg;
uniform float uMotif;
uniform vec3 uA;
uniform vec3 uB;
uniform float uWarp;
uniform float uGrain;
uniform float uBands;
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

vec3 space(vec3 dir, float t) {
  vec3 col = uBg * 0.25;
  float n = fbm(dir.xy * 2.4 + dir.z * 1.7 + t * 0.012);
  col += uAccent * (n * n) * 0.45;
  float speckle = hash2(floor(dir.xy * 520.0 + dir.z * 210.0));
  float star = pow(speckle, 28.0);
  float giant = pow(hash2(floor(dir.xz * 110.0)), 14.0);
  col += vec3(1.0) * star * (2.2 + uAudio * 2.8);
  col += mix(vec3(1.0), uAccent, 0.4) * giant * (0.9 + uAudio);
  return col;
}

vec3 fractal(vec3 dir, float t) {
  vec2 z = vec2(dir.x, dir.z) / (1.15 + abs(dir.y)) * (1.55 + 0.25 * sin(t * 0.04));
  vec2 c = vec2(-0.745 + 0.08 * sin(t * 0.035), 0.186 + 0.07 * cos(t * 0.027));
  float m = 0.0;
  for (int i = 0; i < 48; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 12.0) { m = float(i); break; }
  }
  float esc = m / 48.0;
  vec3 inner = mix(uBg, uAccent, 0.4);
  vec3 rim = mix(uAccent, vec3(1.0), 0.4);
  return mix(inner, rim, pow(esc, 0.65));
}

vec3 matrixRain(vec3 dir, float t) {
  float lon = atan(dir.z, dir.x);
  float lat = acos(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 0.15915494 + 0.5, lat * 0.31830989);
  float cols = 280.0;
  float rows = 160.0;
  float col = floor(uv.x * cols);
  float speed = 0.7 + hash(col) * 2.5;
  float y = uv.y * rows + t * speed;
  float row = floor(y);
  vec2 cell = fract(vec2(uv.x * cols, y));
  vec2 gp = cell * vec2(7.0, 9.0);
  vec2 gi = floor(gp);
  float inGlyph = step(1.0, gi.x) * step(gi.x, 5.0) * step(1.0, gi.y) * step(gi.y, 7.0);
  float flicker = floor(t * (3.0 + hash(col) * 4.0));
  float bit = hash2(vec2(col * 19.17 + gi.x * 3.1, row * 11.13 + gi.y * 5.7 + flicker));
  float glyph = inGlyph * step(0.46, bit) * step(0.22, fract(gp.x)) * step(0.18, fract(gp.y));
  float drop = fract(hash(col + 2.1) + t * (0.06 + hash(col * 3.1) * 0.14));
  float lead = fract(uv.y - drop);
  float head = exp(-lead * 22.0);
  float trail = exp(-lead * 5.5) * step(lead, 0.62);
  float glow = glyph * (0.12 + trail * 0.95);
  vec3 green = mix(uAccent, vec3(0.12, 0.95, 0.38), 0.72);
  vec3 c = uBg * 0.06;
  c += green * glow;
  c += vec3(0.78, 1.0, 0.82) * glyph * pow(head, 2.4) * 1.6;
  return c;
}

vec3 aurora(vec3 dir, float t) {
  float lon = atan(dir.z, dir.x);
  float w = fbm(vec2(lon * 1.4, dir.y * 3.2 + t * 0.08));
  float belt = exp(-pow(dir.y - 0.22, 2.0) * 3.2);
  float curtain = belt * smoothstep(0.18, 0.78, w) * (0.5 + 0.5 * max(0.0, dir.y + 0.4));
  float band = sin(dir.y * 8.0 + w * 4.0 + t * 0.3);
  vec3 c = uBg * 0.16;
  c += mix(uAccent, vec3(0.2, 0.95, 0.55), 0.55) * curtain * (0.75 + 0.35 * band);
  c += vec3(0.55, 0.2, 0.9) * curtain * pow(max(0.0, band), 3.0) * 0.55;
  return c;
}

vec3 rainSky(vec3 dir, float t) {
  float lon = atan(dir.z, dir.x);
  float lat = acos(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 0.15915 + 0.5, lat * 0.3183);
  float col = floor(uv.x * 90.0);
  float speed = 1.4 + hash(col) * 3.2;
  float y = fract(uv.y * 14.0 + t * speed * 0.18);
  float streak = exp(-y * 8.0) * step(0.88, hash2(vec2(col, floor(uv.y * 14.0 + t * speed))));
  vec3 c = uBg * 0.2;
  c += mix(uAccent, vec3(0.55, 0.7, 0.95), 0.6) * streak * (1.2 + uAudio);
  return c;
}

vec3 oceanSky(vec3 dir, float t) {
  vec2 p = vec2(dir.x, dir.z) / (0.35 + abs(dir.y));
  float w = fbm(p * 2.2 + t * 0.06);
  float caust = pow(abs(sin(p.x * 6.0 + w * 4.0 + t * 0.4) * sin(p.y * 5.0 - w * 3.0)), 3.0);
  vec3 deep = mix(uBg, vec3(0.02, 0.12, 0.28), 0.7);
  vec3 lite = mix(uAccent, vec3(0.2, 0.85, 0.75), 0.5);
  return mix(deep, lite, 0.25 + 0.55 * w) + lite * caust * 0.55;
}

vec3 fireSky(vec3 dir, float t) {
  float h = 0.5 + 0.5 * dir.y;
  vec2 p = vec2(atan(dir.z, dir.x), h) * vec2(1.2, 3.5);
  float n = fbm(p + vec2(0.0, -t * 0.35));
  float flame = pow(clamp(n * (1.15 - h), 0.0, 1.0), 1.4);
  vec3 c = mix(vec3(0.08, 0.02, 0.0), vec3(0.95, 0.35, 0.05), flame);
  c = mix(c, vec3(1.0, 0.85, 0.35), pow(flame, 3.0));
  c += uAccent * flame * 0.15;
  return mix(uBg * 0.2, c, 0.85);
}

vec3 warpSky(vec3 dir, float t) {
  float r = length(dir.xz);
  float ang = atan(dir.z, dir.x);
  float streak = pow(hash2(vec2(floor(ang * 80.0), floor(r * 40.0 - t * 2.0))), 18.0);
  float tunnel = exp(-abs(dir.y) * 2.2);
  vec3 c = uBg * 0.12;
  c += mix(vec3(1.0), uAccent, 0.45) * streak * (1.6 + uAudio) * (0.4 + tunnel);
  c += uAccent * pow(max(0.0, 1.0 - r * 0.5), 3.0) * 0.2;
  return c;
}

vec3 cloudsSky(vec3 dir, float t) {
  vec2 p = dir.xz / (0.55 + abs(dir.y));
  float n = fbm(p * 1.6 + t * 0.02);
  float n2 = fbm(p * 3.1 - t * 0.015);
  float cover = smoothstep(0.32, 0.72, n * 0.7 + n2 * 0.3);
  vec3 sky = mix(mix(uBg, uAccent, 0.15), vec3(0.45, 0.62, 0.88), 0.35 + 0.2 * dir.y);
  vec3 cld = mix(vec3(0.75, 0.78, 0.85), vec3(1.0), n2);
  return mix(sky, cld, cover * (0.55 + 0.25 * (1.0 - abs(dir.y))));
}

vec3 circuitSky(vec3 dir, float t) {
  float lon = atan(dir.z, dir.x) * 0.15915;
  vec2 uv = vec2(lon, dir.y) * 18.0;
  vec2 g = abs(fract(uv) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.06, min(g.x, g.y));
  float pulse = step(0.92, hash2(floor(uv) + floor(t * 1.5)));
  vec3 c = uBg * 0.12;
  c += uAccent * line * 0.35;
  c += mix(uAccent, vec3(0.4, 1.0, 0.8), 0.5) * pulse * line * 1.4;
  return c;
}

vec3 plasmaSky(vec3 dir, float t) {
  float a = sin(dir.x * 4.0 + t * 0.3);
  float b = sin(dir.y * 5.0 + dir.z * 3.0 + t * 0.22);
  float c = sin((dir.x + dir.y) * 3.5 - t * 0.18);
  float m = 0.5 + 0.5 * (a * b + c) * 0.7;
  return mix(mix(uBg, uAccent, 0.25), mix(uAccent, vec3(0.9, 0.3, 0.7), 0.4), m);
}

vec3 latticeSky(vec3 dir, float t) {
  vec3 p = dir * 12.0;
  vec3 g = abs(fract(p) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.035, min(min(g.x, g.y), g.z));
  float twinkle = pow(hash2(floor(p.xy + t * 0.1)), 10.0);
  vec3 c = uBg * 0.08;
  c += uAccent * line * 0.45;
  c += vec3(1.0) * twinkle * 0.8;
  return c;
}

vec3 dynamicSky(vec3 dir, float t) {
  vec2 uv = vec2(atan(dir.z, dir.x), dir.y);
  uv += uWarp * vec2(fbm(uv * 2.0 + t * 0.05) - 0.5, fbm(uv.yx * 2.0 - t * 0.04) - 0.5);
  float m = uMotif;
  float pat;
  if (m < 0.5) {
    pat = pow(max(0.0, uv.y), 1.2) * (0.5 + 0.5 * sin(uv.y * uBands * 2.0 + fbm(uv * 3.0) * 4.0 + t * 0.25));
  } else if (m < 1.5) {
    vec2 i = floor(uv * uBands);
    pat = 1.0 - smoothstep(0.1, 0.55, length(fract(uv * uBands) - 0.5) + 0.2 * hash2(i));
  } else if (m < 2.5) {
    pat = 0.5 + 0.5 * sin(uv.x * uBands + uv.y * 2.0 + t * 0.3);
  } else if (m < 3.5) {
    float r = length(uv);
    pat = 0.5 + 0.5 * sin(r * uBands * 4.0 - atan(uv.y, uv.x) * 3.0 + t * 0.4);
  } else if (m < 4.5) {
    pat = fbm(uv * uBands + t * 0.08);
  } else {
    pat = pow(abs(sin(uv.x * uBands + sin(uv.y * 5.0 + t * 0.2) * 2.0)), 2.0);
  }
  vec3 col = mix(uA, uB, clamp(pat, 0.0, 1.0));
  col += (hash2(uv * 80.0 + t) - 0.5) * uGrain * 0.35;
  return mix(uBg * 0.2, col, 0.85);
}

${SKY_LUMA_CAP_GLSL}
void main() {
  vec3 dir = normalize(vDir);
  float t = uTime;
  vec3 col;
  if (uMode < 1.5) col = fractal(dir, t);
  else if (uMode < 2.5) col = space(dir, t);
  else if (uMode < 3.5) col = matrixRain(dir, t);
  else if (uMode < 5.5) col = aurora(dir, t);
  else if (uMode < 6.5) col = rainSky(dir, t);
  else if (uMode < 7.5) col = oceanSky(dir, t);
  else if (uMode < 8.5) col = fireSky(dir, t);
  else if (uMode < 9.5) col = warpSky(dir, t);
  else if (uMode < 10.5) col = cloudsSky(dir, t);
  else if (uMode < 11.5) col = circuitSky(dir, t);
  else if (uMode < 12.5) col = plasmaSky(dir, t);
  else if (uMode < 13.5) col = latticeSky(dir, t);
  else col = dynamicSky(dir, t);
  fragColor = vec4(capSkyLuma(col * uBright), uOpacity);
}
`;

const MODE_NUM: Record<BackdropKind, number> = {
  none: 0, fractal: 1, space: 2, matrix: 3, live: 4,
  aurora: 5, rain: 6, ocean: 7, fire: 8, warp: 9, clouds: 10, circuit: 11, plasma: 12, lattice: 13,
  dynamic: 14,
  custom: 15,
  plugin: 16,
};

const LIVE_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const LIVE_FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform vec2 uCanvas;
uniform vec2 uVideoSize;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform float uLumaCap;
uniform vec3 uBg;
in vec2 vUv;
out vec4 fragColor;

${SKY_LUMA_CAP_GLSL}
void main() {
  vec2 canvas = max(uCanvas, vec2(1.0));
  vec2 video = max(uVideoSize, vec2(1.0));
  float ca = canvas.x / canvas.y;
  float va = video.x / video.y;
  // object-fit: cover. scale is the fraction of the video that fits the canvas along each axis
  // (a wider canvas shows the full video width and a band of its height), sampled about the centre.
  vec2 scale = ca > va ? vec2(1.0, va / ca) : vec2(ca / va, 1.0);
  vec2 uv = (vUv - 0.5) * scale + 0.5;
  vec3 col = texture(uVideo, uv).rgb;
  col *= uBright * (0.85 + 0.35 * uAudio);
  vec3 capped = capSkyLumaTo(col, uLumaCap);
  vec3 outc = mix(uBg, capped, uOpacity);
  fragColor = vec4(capSkyLumaTo(outc, uLumaCap), 1.0);
}
`;

/** how much the pulse accelerates the sky at full level (a 1.0 pulse runs the clock 3.4× the slider speed) */
const PULSE_ACCEL = 2.4;
/** the easing slider maps 0..1 onto this many seconds of time constant (quadratic, so the low end stays crisp) */
const EASE_MAX_S = 3;
/** how long a Dynamic palette/motif morph takes at skyEase=1; ease=0 snaps */
export const RECIPE_EASE_MAX_S = 4.2;

function blankTex(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([20, 24, 32, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Last compiled agent fragment, so arcade LookStage skies can share it. */
let lastCustomFrag: string | null = null;

/** Last accepted plugin fragment, so LookStage's separate Backdrop can share it. */
let lastPlugin: { id: string; frag: string } | null = null;

export { PLUGIN_SKY_UNIFORMS } from "../plugins/plugin-sky-uniforms";
export const PLUGIN_SKY_MAX = 16_000;
export const PLUGIN_SKY_FALLBACK: BackdropKind = "space";

const PLUGIN_UNIFORM_RE =
  /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|vec[234]|int|uint|bool|mat[234]|sampler(?:2D|3D|Cube))\s+(\w+)\s*;/g;
const PLUGIN_ALLOWED = new Set<string>(PLUGIN_SKY_UNIFORMS);

/** Reject includes and any uniform outside the frozen plugin sky contract. */
export function pluginShaderError(src: string): string | null {
  if (!src.trim()) return "empty shader";
  if (src.length > PLUGIN_SKY_MAX) return "shader too long";
  if (/#\s*include\b/i.test(src) || /\bimport\s/.test(src)) return "shader includes are not allowed";
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

/** Bind the whitelist preamble to a self-contained plugin fragment. */
export function wrapPluginSky(raw: string): { frag: string } | { error: string } {
  const err = pluginShaderError(raw);
  if (err) return { error: err };
  const body = raw.replace(/#version[^\n]*\n?/g, "").replace(/\bprecision\s+\w+\s+float\s*;/g, "").trim();
  const stripped = body
    .replace(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|vec[234])\s+(?:uTime|uOpacity|uBright|uAudio|uAccent|uBg)\s*;/g, "")
    .replace(/\bin\s+vec3\s+vDir\s*;/g, "")
    .replace(/\bout\s+vec4\s+fragColor\s*;/g, "")
    .trim();
  const preamble = /* glsl */ `${VIZ_UBO_GLSL}
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

export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly liveMesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly liveMat: THREE.ShaderMaterial;
  private pluginMat: THREE.ShaderMaterial | null = null;
  private pluginId: string | null = null;
  private pluginFrag: string | null = null;
  private readonly pluginUbo = new Float32Array(VIZ_UBO.totalFloats);
  private kind: BackdropKind = "none";
  private customFrag: string | null = null;
  /** the sky's animation clock, in shader seconds: integrates dt × current speed */
  private clock = 0;
  /** speed multiplier the clock is running at now; eases toward speed × (1 + pulse × PULSE_ACCEL) */
  private curSpeed = 1;
  private speed = 1;
  private ease = 0.4;
  private audio = 0;
  private lastT: number | null = null;
  private paintedRecipe: SkyRecipe = cloneSkyRecipe(DEFAULT_SKY_RECIPE);
  private recipeFrom: SkyRecipe = cloneSkyRecipe(DEFAULT_SKY_RECIPE);
  private recipeWant: SkyRecipe = cloneSkyRecipe(DEFAULT_SKY_RECIPE);
  private recipeT = 1;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMode: { value: 1 },
        uOpacity: { value: 1 },
        uBright: { value: 1 },
        uAudio: { value: 0 },
        uAccent: { value: new THREE.Color(0x5aa9ff) },
        uBg: { value: new THREE.Color(0x0b0e14) },
        uMotif: { value: DEFAULT_SKY_RECIPE.motif },
        uA: { value: new THREE.Color().setRGB(...DEFAULT_SKY_RECIPE.a) },
        uB: { value: new THREE.Color().setRGB(...DEFAULT_SKY_RECIPE.b) },
        uWarp: { value: DEFAULT_SKY_RECIPE.warp },
        uGrain: { value: DEFAULT_SKY_RECIPE.grain },
        uBands: { value: DEFAULT_SKY_RECIPE.bands },
        uPhoto: { value: blankTex() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2800, 48, 32), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.visible = false;

    this.liveMat = new THREE.ShaderMaterial({
      uniforms: {
        uVideo: { value: null },
        uCanvas: { value: new THREE.Vector2(16, 9) },
        uVideoSize: { value: new THREE.Vector2(16, 9) },
        uOpacity: { value: 1 },
        uBright: { value: 1 },
        uAudio: { value: 0 },
        uLumaCap: { value: SKY_LUMA_CAP },
        uBg: { value: new THREE.Color(0x0b0e14) },
      },
      vertexShader: LIVE_VERT,
      fragmentShader: LIVE_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.liveMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.liveMat);
    this.liveMesh.frustumCulled = false;
    this.liveMesh.renderOrder = -11;
    this.liveMesh.visible = false;
  }

  setKind(kind: BackdropKind): void {
    if (kind === "custom") {
      const frag = this.customFrag || lastCustomFrag;
      if (frag) {
        this.customFrag = frag;
        this.dropPluginMat();
        this.applyFrag(frag);
      } else {
        kind = "dynamic";
        this.dropPluginMat();
      }
    } else if (kind === "plugin") {
      const ready = this.pluginFrag || lastPlugin?.frag || null;
      if (ready) {
        this.ensurePluginMat(lastPlugin?.id ?? this.pluginId ?? "plugin", ready);
      } else {
        this.dropPluginMat();
        if (this.mat.fragmentShader !== FRAG) this.applyFrag(FRAG);
      }
    } else {
      this.dropPluginMat();
      if (this.mat.fragmentShader !== FRAG) this.applyFrag(FRAG);
    }
    this.kind = kind;
    this.mesh.visible = kind !== "none" && kind !== "live";
    this.liveMesh.visible = kind === "live";
    const modeKind = kind === "plugin" && !this.pluginMat ? PLUGIN_SKY_FALLBACK : kind;
    this.mat.uniforms.uMode.value = MODE_NUM[modeKind] ?? 0;
    if (kind === "dynamic") this.setRecipe(currentSkyRecipe());
    if (kind === "live" && liveCam.texture) {
      this.liveMat.uniforms.uVideo.value = liveCam.texture;
      this.liveMesh.visible = true;
    }
  }

  /**
   * Compile a plugin ``sky/fragment.glsl`` onto the sphere. Returns a contract/compile
   * error, or null if the host accepted it. ``null`` source restores the shipped program.
   */
  setPluginShader(opts: { id: string; source: string } | null): string | null {
    if (!opts) {
      lastPlugin = null;
      this.pluginId = null;
      this.pluginFrag = null;
      this.dropPluginMat();
      if (this.kind === "plugin") this.setKind("plugin");
      return null;
    }
    const wrapped = wrapPluginSky(opts.source);
    if ("error" in wrapped) {
      lastPlugin = null;
      this.pluginId = null;
      this.pluginFrag = null;
      this.dropPluginMat();
      if (this.kind === "plugin") this.setKind("plugin");
      return wrapped.error;
    }
    lastPlugin = { id: opts.id, frag: wrapped.frag };
    this.pluginId = opts.id;
    this.pluginFrag = wrapped.frag;
    if (this.kind === "plugin") this.setKind("plugin");
    return null;
  }

  /** Install a Gemma fragment. Returns a compile-wrap error, or null if the host accepted it. */
  setCustom(src: string | null): string | null {
    if (!src) {
      this.customFrag = null;
      lastCustomFrag = null;
      if (this.kind === "custom") this.setKind("dynamic");
      return null;
    }
    const wrapped = wrapAgentSky(src);
    if ("error" in wrapped) return wrapped.error;
    this.customFrag = wrapped.frag;
    lastCustomFrag = wrapped.frag;
    if (this.kind === "custom") this.applyFrag(wrapped.frag);
    return null;
  }

  setPhoto(tex: THREE.Texture | null): void {
    this.mat.uniforms.uPhoto.value = tex ?? blankTex();
  }

  private applyFrag(src: string): void {
    this.mat.fragmentShader = src;
    this.mat.needsUpdate = true;
  }

  private pluginUniforms(): THREE.ShaderMaterial["uniforms"] {
    const u = this.mat.uniforms;
    return {
      uTime: { value: u.uTime.value },
      uOpacity: { value: u.uOpacity.value },
      uBright: { value: u.uBright.value },
      uAudio: { value: u.uAudio.value },
      uAccent: { value: (u.uAccent.value as THREE.Color).clone() },
      uBg: { value: (u.uBg.value as THREE.Color).clone() },
      [VIZ_UBO.threeUniform]: { value: this.pluginUbo },
    };
  }

  private ensurePluginMat(id: string, frag: string): void {
    if (this.pluginMat && this.pluginFrag === frag && this.pluginId === id) {
      this.mesh.material = this.pluginMat;
      return;
    }
    this.dropPluginMat(false);
    this.pluginId = id;
    this.pluginFrag = frag;
    this.pluginMat = new THREE.ShaderMaterial({
      uniforms: this.pluginUniforms(),
      vertexShader: VERT,
      fragmentShader: frag,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh.material = this.pluginMat;
  }

  /** Plugin id currently bound to the sphere, or null when the shipped program is showing. */
  pluginSkyId(): string | null {
    return this.pluginMat && this.mesh.material === this.pluginMat ? this.pluginId : null;
  }

  /** Copy the host viz UBO mirror into the active plugin shader (std140 layout). */
  setPluginUboBuffer(buf: Float32Array): void {
    if (buf.length !== VIZ_UBO.totalFloats) return;
    this.pluginUbo.set(buf);
    const mat = this.pluginMat;
    if (!mat || this.mesh.material !== mat) return;
    const u = mat.uniforms[VIZ_UBO.threeUniform];
    if (u) u.value = this.pluginUbo;
  }

  /** Write one whitelisted sky uniform on the active plugin shader material. */
  setPluginUniform(name: string, value: number | [number, number, number]): boolean {
    if (!this.pluginMat || this.mesh.material !== this.pluginMat) return false;
    const u = this.pluginMat.uniforms[name];
    if (!u) return false;
    if (name === "uAccent" || name === "uBg") {
      if (!Array.isArray(value) || value.length !== 3) return false;
      (u.value as THREE.Color).setRGB(value[0], value[1], value[2]);
      return true;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    u.value = value;
    return true;
  }

  private dropPluginMat(clear = true): void {
    if (this.mesh.material === this.pluginMat) this.mesh.material = this.mat;
    if (this.pluginMat) {
      this.pluginMat.dispose();
      this.pluginMat = null;
    }
    if (clear) {
      this.pluginId = null;
      this.pluginFrag = null;
    }
  }

  private syncPluginLook(): void {
    if (!this.pluginMat) return;
    const src = this.mat.uniforms;
    const dst = this.pluginMat.uniforms;
    dst.uTime.value = src.uTime.value;
    dst.uOpacity.value = src.uOpacity.value;
    dst.uBright.value = src.uBright.value;
    dst.uAudio.value = src.uAudio.value;
    (dst.uAccent.value as THREE.Color).copy(src.uAccent.value as THREE.Color);
    (dst.uBg.value as THREE.Color).copy(src.uBg.value as THREE.Color);
  }

  /** Colours currently on the AI Dynamic sky, for label-ink luminance. */
  skyPalette(): { a: [number, number, number]; b: [number, number, number] } {
    return { a: this.paintedRecipe.a, b: this.paintedRecipe.b };
  }

  setRecipe(r: SkyRecipe): void {
    this.recipeWant = cloneSkyRecipe(r);
    this.recipeFrom = cloneSkyRecipe(r);
    this.paintedRecipe = cloneSkyRecipe(r);
    this.recipeT = 1;
    this.applyRecipe(r);
  }

  private applyRecipe(r: SkyRecipe): void {
    this.mat.uniforms.uMotif.value = r.motif;
    (this.mat.uniforms.uA.value as THREE.Color).setRGB(r.a[0], r.a[1], r.a[2]);
    (this.mat.uniforms.uB.value as THREE.Color).setRGB(r.b[0], r.b[1], r.b[2]);
    this.mat.uniforms.uWarp.value = r.warp;
    this.mat.uniforms.uGrain.value = r.grain;
    this.mat.uniforms.uBands.value = r.bands;
  }

  private followRecipe(r: SkyRecipe, dt: number): void {
    if (skyRecipeKey(r) !== skyRecipeKey(this.recipeWant)) {
      this.recipeFrom = cloneSkyRecipe(this.paintedRecipe);
      this.recipeWant = cloneSkyRecipe(r);
      this.recipeT = 0;
    }
    if (this.ease < 0.08) this.recipeT = 1;
    else {
      const tau = 0.45 + RECIPE_EASE_MAX_S * this.ease * this.ease;
      this.recipeT = Math.min(1, this.recipeT + (1 - this.recipeT) * (1 - Math.exp(-dt / tau)));
    }
    this.paintedRecipe = lerpSkyRecipe(this.recipeFrom, this.recipeWant, this.recipeT);
    this.applyRecipe(this.paintedRecipe);
  }

  setViewport(w: number, h: number): void {
    (this.liveMat.uniforms.uCanvas.value as THREE.Vector2).set(w, h);
  }

  setColors(accent: number, bg: number): void {
    (this.mat.uniforms.uAccent.value as THREE.Color).setHex(accent);
    (this.mat.uniforms.uBg.value as THREE.Color).setHex(bg);
    (this.liveMat.uniforms.uBg.value as THREE.Color).setHex(bg);
    this.syncPluginLook();
  }

  setLumaCap(cap: number): void {
    this.liveMat.uniforms.uLumaCap.value = Math.min(SKY_LUMA_CAP, Math.max(0.04, cap));
  }

  setLook(opacity: number, brightness: number, audio: number): void {
    this.audio = audio;
    this.mat.uniforms.uOpacity.value = opacity;
    this.mat.uniforms.uBright.value = brightness;
    this.mat.uniforms.uAudio.value = audio;
    this.liveMat.uniforms.uOpacity.value = opacity;
    this.liveMat.uniforms.uBright.value = brightness;
    this.liveMat.uniforms.uAudio.value = audio;
    this.syncPluginLook();
  }

  /**
   * How the sky's clock runs. `speed` multiplies the animation rate (0 freezes it); `ease` (0..1) is how gently the
   * rate follows its target when the pulse pushes it or the slider moves: 0 snaps within a frame or two, 1 glides
   * over a few seconds.
   */
  setMotion(speed: number, ease: number): void {
    this.speed = Math.max(0, speed);
    this.ease = Math.min(1, Math.max(0, ease));
  }

  /** Advance the sky by wall-clock time `t` (seconds); the animation clock itself runs at the eased speed. */
  tick(t: number): void {
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, t - this.lastT)); // a hidden tab resumes without a leap
    this.lastT = t;
    if (this.kind === "none") return;
    const target = this.speed * (1 + this.audio * PULSE_ACCEL);
    const tau = 0.04 + EASE_MAX_S * this.ease * this.ease;
    this.curSpeed += (target - this.curSpeed) * (1 - Math.exp(-dt / tau));
    this.clock += dt * this.curSpeed;
    this.mat.uniforms.uTime.value = this.clock;
    this.syncPluginLook();
    if (this.kind === "dynamic") this.followRecipe(currentSkyRecipe(), dt);
    if (this.kind === "live") {
      const v = liveCam.video;
      if (v.videoWidth > 0) {
        (this.liveMat.uniforms.uVideoSize.value as THREE.Vector2).set(v.videoWidth, v.videoHeight);
      }
      if (liveCam.texture && this.liveMat.uniforms.uVideo.value !== liveCam.texture) {
        this.liveMat.uniforms.uVideo.value = liveCam.texture;
        this.liveMesh.visible = true;
      }
    }
  }
}
