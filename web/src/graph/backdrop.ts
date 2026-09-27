import * as THREE from "three";
import { PLUGIN_SKY_UNIFORMS } from "../plugins/plugin-sky-uniforms";
import { PLUGIN_SKY_HOST_UNIFORMS } from "../plugins/plugin-sky-uniforms";
import { VIZ_UBO, VIZ_UBO_GLSL } from "../plugins/viz-host";
import { liveCam } from "../camera/livecam";
import { SKY_LUMA_CAP, SKY_LUMA_CAP_GLSL } from "../core/themes";
import { currentSkyRecipe, DEFAULT_SKY_RECIPE, cloneSkyRecipe, lerpSkyRecipe, skyRecipeKey, type SkyRecipe } from "./sky-ai";
import { VIEW_MORPH_S, mixFade } from "./morph";
import { wrapAgentSky } from "./sky-agent";
import { releaseThrowawayGl } from "./webgl";
import { loadHtmlImage } from "../core/load-image";
import { smokeBackroomsSkyTime } from "../core/smoke-harness";

/**
 * Far-field sky behind the graph: a huge inward sphere around the origin so orbiting the network
 * reads as flying through space / rain / a fractal, while the device cloud stays in the foreground.
 */

export type PhotoSkyKind =
  | "earth" | "meadow" | "tunnel" | "bomb" | "reef" | "tornado" | "desert" | "amazon"
  | "aquarium" | "macaws" | "ruins" | "fungi";

export type BackdropKind =
  | "none" | "fractal" | "space" | "matrix" | "live"
  | "aurora" | "rain" | "ocean" | "fire" | "warp" | "clouds" | "circuit" | "plasma" | "lattice"
  | "dusk" | "void" | "vhs" | "nebula" | "acid" | "ice" | "dawn" | "phosphor"
  | PhotoSkyKind
  | "dynamic" | "custom" | "plugin";

export type SkyGroup = "plain" | "nature" | "digital" | "live" | "photo";

export const PHOTO_SKIES: Record<PhotoSkyKind, string> = {
  earth: "/skies/earth.jpg",
  meadow: "/skies/meadow.jpg",
  tunnel: "/skies/tunnel.jpg",
  bomb: "/skies/bomb.jpg",
  reef: "/skies/reef.jpg",
  tornado: "/skies/tornado.jpg",
  desert: "/skies/desert.jpg",
  amazon: "/skies/amazon.jpg",
  aquarium: "/skies/aquarium.jpg",
  macaws: "/skies/macaws.jpg",
  ruins: "/skies/ruins.jpg",
  fungi: "/skies/fungi.jpg",
};

/** Target length of a photo-sky video loop (seconds). Stills Ken-Burns on this period until a clip lands. */
export const PHOTO_LOOP_S = 5;
/** Crossfade from the last frames onto a second decoder at t=0 so the wrap has no hitch. */
export const PHOTO_LOOP_FADE_S = 0.35;

/** 0..1 phase of the photo-sky loop. */
export function photoLoopPhase(t: number, period = PHOTO_LOOP_S): number {
  const p = period > 0 ? period : PHOTO_LOOP_S;
  return (((t % p) + p) % p) / p;
}

/**
 * Mix of the incoming pass (start) over the outgoing pass (end).
 * 0 until the fade window; 1 at the last instant before wrap. At t === duration the phase is 0 again.
 */
export function photoLoopMix(t: number, duration: number, fade = PHOTO_LOOP_FADE_S): number {
  if (!(duration > 0) || !(fade > 0) || duration <= fade * 2) return 0;
  const p = ((t % duration) + duration) % duration;
  const start = duration - fade;
  if (p < start) return 0;
  return (p - start) / fade;
}

/** Cover-fit Ken Burns UV + breath. Closed over `period` (t and t+period match). */
export function photoStillLoopSample(u: number, v: number, t: number, period = PHOTO_LOOP_S): {
  x: number; y: number; zoom: number; breath: number;
} {
  const ang = photoLoopPhase(t, period) * Math.PI * 2;
  const zoom = 1.08 + 0.035 * Math.sin(ang);
  const x0 = (u - 0.5) / zoom + 0.5 + Math.cos(ang) * 0.018;
  const y0 = (v - 0.5) / zoom + 0.5 + Math.sin(ang * 2) * 0.018;
  return {
    x: x0 + 0.0035 * Math.sin(ang + y0 * 5.5),
    y: y0 + 0.0035 * Math.cos(ang + x0 * 4.5),
    zoom,
    breath: 0.975 + 0.04 * Math.sin(ang),
  };
}

export function isPhotoSky(kind: BackdropKind): kind is PhotoSkyKind {
  return Object.hasOwn(PHOTO_SKIES, kind);
}

/** True for looping sky clips (not the JPEG poster). */
export function isPhotoVideoUrl(url: string): boolean {
  return /\.(webm|mp4|ogv)(?:[?#]|$)/i.test(url);
}

/** Prefer a 5 s muted loop, then the JPEG poster. Drop `/skies/<id>.webm` beside the still. */
export function photoSkyCandidates(kind: PhotoSkyKind): string[] {
  return [`/skies/${kind}.webm`, `/skies/${kind}.mp4`, PHOTO_SKIES[kind]];
}

export const SKY_GROUP_TABS: { id: string; label: string }[] = [
  { id: "all", label: "all" },
  { id: "nature", label: "nature" },
  { id: "photo", label: "photo" },
  { id: "digital", label: "digital" },
  { id: "live", label: "live / AI" },
  { id: "plain", label: "plain" },
];

export function skyGroup(kind: BackdropKind): SkyGroup {
  if (kind === "none") return "plain";
  if (isPhotoSky(kind)) return "photo";
  if (kind === "live" || kind === "dynamic" || kind === "custom" || kind === "plugin") return "live";
  if (kind === "aurora" || kind === "rain" || kind === "ocean" || kind === "fire"
    || kind === "clouds" || kind === "dusk" || kind === "dawn" || kind === "ice" || kind === "nebula") {
    return "nature";
  }
  return "digital";
}

export const BACKDROP_OPTIONS: { value: BackdropKind; label: string; hint: string; group: SkyGroup }[] = [
  { value: "none", label: "none", hint: "plain fog", group: "plain" },
  { value: "fractal", label: "fractal", hint: "slow Julia set", group: "digital" },
  { value: "space", label: "space", hint: "starfield", group: "digital" },
  { value: "matrix", label: "matrix", hint: "falling code", group: "digital" },
  { value: "aurora", label: "aurora", hint: "polar curtains", group: "nature" },
  { value: "rain", label: "rain", hint: "falling streaks", group: "nature" },
  { value: "ocean", label: "ocean", hint: "underwater caustics", group: "nature" },
  { value: "fire", label: "fire", hint: "rising embers", group: "nature" },
  { value: "warp", label: "warp", hint: "star-streak tunnel", group: "digital" },
  { value: "clouds", label: "clouds", hint: "soft fbm overcast", group: "nature" },
  { value: "circuit", label: "circuit", hint: "trace lattice", group: "digital" },
  { value: "plasma", label: "plasma", hint: "interference wash", group: "digital" },
  { value: "lattice", label: "lattice", hint: "night grid", group: "digital" },
  { value: "dusk", label: "dusk", hint: "warm horizon, purple zenith", group: "nature" },
  { value: "void", label: "void", hint: "near-black sparse stars", group: "digital" },
  { value: "vhs", label: "VHS", hint: "scanlines and chroma split", group: "digital" },
  { value: "nebula", label: "nebula", hint: "colour gas clouds", group: "nature" },
  { value: "acid", label: "acid", hint: "high-sat swirl", group: "digital" },
  { value: "ice", label: "ice", hint: "crystalline facets", group: "nature" },
  { value: "dawn", label: "dawn", hint: "peach and rose horizon", group: "nature" },
  { value: "phosphor", label: "phosphor", hint: "P1 CRT green bloom", group: "digital" },
  { value: "earth", label: "Earth", hint: "photo / video loop: Earth from orbit", group: "photo" },
  { value: "meadow", label: "meadow", hint: "photo / video loop: sunny meadow", group: "photo" },
  { value: "tunnel", label: "tunnel", hint: "photo / video loop: dark tunnel", group: "photo" },
  { value: "bomb", label: "bomb", hint: "photo / video loop: hydrogen bomb mushroom cloud", group: "photo" },
  { value: "reef", label: "reef", hint: "photo / video loop: coral reef", group: "photo" },
  { value: "tornado", label: "tornado", hint: "photo / video loop: plains tornado", group: "photo" },
  { value: "desert", label: "desert", hint: "photo / video loop: desert heat", group: "photo" },
  { value: "amazon", label: "amazon", hint: "photo / video loop: Amazon rainforest", group: "photo" },
  { value: "aquarium", label: "aquarium", hint: "photo / video loop: aquarium tank", group: "photo" },
  { value: "macaws", label: "macaws", hint: "photo / video loop: macaws in jungle", group: "photo" },
  { value: "ruins", label: "ruins", hint: "photo / video loop: Incan ruins", group: "photo" },
  { value: "fungi", label: "fungi", hint: "photo / video loop: bioluminescent mushroom forest", group: "photo" },
  { value: "dynamic", label: "AI Dynamic", hint: "Gemma rebuilds this sky on a timer", group: "live" },
  { value: "custom", label: "agent shader", hint: "GLSL the local agent wrote into the model-named profile", group: "live" },
  { value: "plugin", label: "plugin shader", hint: "GLSL shipped in the selected plugin zip", group: "live" },
  { value: "live", label: "live", hint: "this machine's camera", group: "live" },
];

/** Skies the dream / randomize pool picks from (not none / not Gemma). */
export const CYCLE_SKIES: BackdropKind[] = [
  "fractal", "space", "matrix", "aurora", "rain", "ocean", "fire", "warp", "clouds", "circuit", "plasma", "lattice",
  "dusk", "void", "vhs", "nebula", "acid", "ice", "dawn", "phosphor",
  "earth", "meadow", "tunnel", "bomb", "reef", "tornado", "desert", "amazon",
  "aquarium", "macaws", "ruins", "fungi", "live",
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

vec3 duskSky(vec3 dir, float t) {
  float h = 0.5 + 0.5 * dir.y;
  vec3 zenith = mix(uBg, vec3(0.12, 0.06, 0.22), 0.7);
  vec3 mid = mix(uAccent, vec3(0.72, 0.28, 0.42), 0.45);
  vec3 hor = vec3(0.95, 0.48, 0.18);
  vec3 col = mix(hor, mid, smoothstep(-0.15, 0.35, dir.y));
  col = mix(col, zenith, smoothstep(0.2, 0.95, h));
  float glow = exp(-pow(dir.y + 0.08, 2.0) * 18.0);
  col += hor * glow * 0.55;
  col += uAccent * pow(hash2(floor(dir.xz * 80.0)), 22.0) * (0.35 + 0.4 * h);
  return col;
}

vec3 voidSky(vec3 dir, float t) {
  vec3 col = uBg * 0.08;
  float speckle = pow(hash2(floor(dir.xy * 340.0 + dir.z * 90.0)), 36.0);
  col += vec3(0.75, 0.8, 0.9) * speckle * (1.1 + uAudio);
  float dust = fbm(dir.xz * 1.4 + t * 0.01);
  col += uAccent * dust * dust * 0.12;
  return col;
}

vec3 vhsSky(vec3 dir, float t) {
  float lon = atan(dir.z, dir.x) * 0.15915;
  float lat = acos(clamp(dir.y, -1.0, 1.0)) * 0.3183;
  float scan = 0.82 + 0.18 * sin(lat * 420.0 + t * 8.0);
  float roll = step(0.97, hash2(vec2(floor(t * 4.0), floor(lat * 40.0))));
  vec2 uv = vec2(lon, lat);
  float n = fbm(uv * 6.0 + t * 0.2);
  vec3 base = mix(uBg, uAccent, 0.25 + 0.35 * n);
  vec3 split = vec3(
    mix(base.r, 0.95, 0.15 + 0.1 * sin(t * 3.0)),
    base.g,
    mix(base.b, 0.95, 0.12 + 0.1 * cos(t * 2.4))
  );
  return mix(base, split, 0.55) * scan + vec3(0.08, 0.02, 0.08) * roll;
}

vec3 nebulaSky(vec3 dir, float t) {
  vec2 p = vec2(atan(dir.z, dir.x), dir.y);
  float n = fbm(p * 1.8 + t * 0.03);
  float n2 = fbm(p * 3.4 - t * 0.02);
  float gas = smoothstep(0.28, 0.78, n * 0.65 + n2 * 0.35);
  vec3 cool = mix(uBg, vec3(0.15, 0.2, 0.55), 0.6);
  vec3 hot = mix(uAccent, vec3(0.95, 0.35, 0.65), 0.45);
  vec3 col = mix(cool, hot, gas);
  col += hot * pow(n2, 3.0) * 0.55;
  col += vec3(1.0) * pow(hash2(floor(dir.xy * 200.0)), 24.0);
  return col;
}

vec3 acidSky(vec3 dir, float t) {
  vec2 p = vec2(dir.x, dir.z) / (0.45 + abs(dir.y));
  float a = sin(p.x * 5.0 + t * 0.35);
  float b = sin(p.y * 6.0 - t * 0.28);
  float c = sin((p.x + p.y) * 4.0 + t * 0.2);
  float m = 0.5 + 0.5 * (a * b + c) * 0.7;
  vec3 hi = vec3(0.85, 1.0, 0.12);
  vec3 lo = vec3(0.95, 0.08, 0.72);
  return mix(mix(uBg, lo, 0.45), mix(uAccent, hi, 0.55), m);
}

vec3 iceSky(vec3 dir, float t) {
  vec3 p = dir * 7.5;
  vec3 g = abs(fract(p) - 0.5);
  float facet = 1.0 - smoothstep(0.0, 0.08, min(min(g.x, g.y), g.z));
  float n = fbm(dir.xz * 3.0 + t * 0.02);
  vec3 deep = mix(uBg, vec3(0.04, 0.12, 0.2), 0.65);
  vec3 lite = mix(uAccent, vec3(0.7, 0.9, 1.0), 0.55);
  return mix(deep, lite, 0.2 + 0.45 * n) + lite * facet * 0.55;
}

vec3 dawnSky(vec3 dir, float t) {
  float h = 0.5 + 0.5 * dir.y;
  vec3 zenith = mix(uBg, vec3(0.18, 0.28, 0.55), 0.55);
  vec3 rose = vec3(1.0, 0.62, 0.58);
  vec3 peach = vec3(1.0, 0.78, 0.42);
  vec3 col = mix(peach, rose, smoothstep(-0.2, 0.25, dir.y));
  col = mix(col, zenith, smoothstep(0.15, 0.9, h));
  float glow = exp(-pow(dir.y + 0.12, 2.0) * 14.0);
  col += peach * glow * 0.65;
  return col;
}

vec3 phosphorSky(vec3 dir, float t) {
  float lon = atan(dir.z, dir.x) * 0.15915;
  vec2 uv = vec2(lon, dir.y) * 22.0;
  vec2 g = abs(fract(uv) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.05, min(g.x, g.y));
  float bloom = exp(-min(g.x, g.y) * 18.0);
  float scan = 0.85 + 0.15 * sin(dir.y * 90.0 + t * 6.0);
  vec3 green = mix(uAccent, vec3(0.2, 1.0, 0.35), 0.7);
  vec3 c = uBg * 0.06;
  c += green * line * 0.4;
  c += green * bloom * 0.35;
  c += vec3(0.7, 1.0, 0.7) * pow(hash2(floor(uv) + floor(t * 2.0)), 16.0) * 0.8;
  return c * scan;
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
  else if (uMode < 14.5) col = dynamicSky(dir, t);
  else if (uMode < 17.5) col = duskSky(dir, t);
  else if (uMode < 18.5) col = voidSky(dir, t);
  else if (uMode < 19.5) col = vhsSky(dir, t);
  else if (uMode < 20.5) col = nebulaSky(dir, t);
  else if (uMode < 21.5) col = acidSky(dir, t);
  else if (uMode < 22.5) col = iceSky(dir, t);
  else if (uMode < 23.5) col = dawnSky(dir, t);
  else if (uMode < 24.5) col = phosphorSky(dir, t);
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
  dusk: 17, void: 18, vhs: 19, nebula: 20, acid: 21, ice: 22, dawn: 23, phosphor: 24,
  earth: 25, meadow: 26, tunnel: 27,
  bomb: 28, reef: 29, tornado: 30, desert: 31, amazon: 32,
  aquarium: 33, macaws: 34, ruins: 35, fungi: 36,
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

/** Photographic plates: cover-fit. Ken Burns only when uAnimate is on (JPEG fallback). Video loops play 1:1 with uLoopMix wrapping end onto start. */
const PHOTO_FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform sampler2D uVideoB;
uniform vec2 uCanvas;
uniform vec2 uVideoSize;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform float uLumaCap;
uniform float uTime;
uniform float uAnimate;
uniform float uLoopMix;
uniform vec3 uBg;
in vec2 vUv;
out vec4 fragColor;

${SKY_LUMA_CAP_GLSL}
void main() {
  vec2 canvas = max(uCanvas, vec2(1.0));
  vec2 video = max(uVideoSize, vec2(1.0));
  float ca = canvas.x / canvas.y;
  float va = video.x / video.y;
  vec2 scale = ca > va ? vec2(1.0, va / ca) : vec2(ca / va, 1.0);
  float live = step(0.5, uAnimate);
  float ang = live * fract(max(uTime, 0.0) / 5.0) * 6.28318530718;
  float zoom = mix(1.0, 1.08 + 0.035 * sin(ang), live);
  vec2 pan = live * vec2(cos(ang), sin(ang * 2.0)) * 0.018;
  vec2 uv = (vUv - 0.5) * scale / zoom + 0.5 + pan;
  uv += live * 0.0035 * vec2(sin(ang + uv.y * 5.5), cos(ang + uv.x * 4.5));
  vec3 cola = texture(uVideo, uv).rgb;
  vec3 colb = texture(uVideoB, uv).rgb;
  vec3 col = mix(cola, colb, clamp(uLoopMix, 0.0, 1.0));
  col *= uBright * (0.85 + 0.35 * uAudio) * mix(1.0, 0.975 + 0.04 * sin(ang), live);
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

type PhotoVideoSlot = { el: HTMLVideoElement; tex: THREE.VideoTexture };
type PhotoVideoLoop = { url: string; slots: [PhotoVideoSlot, PhotoVideoSlot]; active: 0 | 1; incoming: boolean };

function makeSkyVideo(url: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.muted = true;
  el.defaultMuted = true;
  el.loop = false;
  el.playsInline = true;
  el.autoplay = false;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.setAttribute("playsinline", "");
  el.setAttribute("muted", "");
  el.src = url;
  return el;
}

function makeSkyVideoTex(el: HTMLVideoElement): THREE.VideoTexture {
  const tex = new THREE.VideoTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Last compiled agent fragment, so arcade LookStage skies can share it. */
let lastCustomFrag: string | null = null;

/** Last accepted plugin fragment, so LookStage's separate Backdrop can share it. */
let lastPlugin: { id: string; frag: string } | null = null;

export { PLUGIN_SKY_UNIFORMS } from "../plugins/plugin-sky-uniforms";
export const PLUGIN_SKY_MAX = 128_000;
export const PLUGIN_SKY_FALLBACK: BackdropKind = "space";

/** Compile the wrapped fragment on a throwaway WebGL2 context. `null` if no GPU or it linked. */
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
    releaseThrowawayGl(gl);
  }
}

const PLUGIN_UNIFORM_RE =
  /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|vec[234]|int|uint|bool|mat[234]|sampler(?:2D|3D|Cube))\s+(\w+)\s*;/g;
const PLUGIN_ALLOWED = new Set<string>([...PLUGIN_SKY_UNIFORMS, ...PLUGIN_SKY_HOST_UNIFORMS]);

/** Reject includes and any uniform outside the frozen plugin sky contract. */
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
  const reserved = src.match(
    /\b(?:float|int|uint|bool|vec[234]|ivec[234]|bvec[234]|uvec[234]|mat[234])\s+(half|fixed|double|short|long|unsigned)\b/,
  );
  if (reserved) return `reserved identifier ${reserved[1]}`;
  return null;
}

/** Bind the whitelist preamble to a self-contained plugin fragment. */
export function wrapPluginSky(raw: string): { frag: string } | { error: string } {
  const err = pluginShaderError(raw);
  if (err) return { error: err };
  const body = raw.replace(/#version[^\n]*\n?/g, "").replace(/\bprecision\s+\w+\s+float\s*;/g, "").trim();
  const stripped = body
    .replace(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|vec[234])\s+(?:uTime|uOpacity|uBright|uAudio|uAccent|uBg|uRenderScale)\s*;/g, "")
    .replace(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?vec2\s+uResolution\s*;/g, "")
    .replace(/\bin\s+vec3\s+vDir\s*;/g, "")
    .replace(/\bout\s+vec4\s+fragColor\s*;/g, "")
    .trim();
  const preamble = /* glsl */ `${VIZ_UBO_GLSL}
uniform vec2 uResolution;
uniform float uTime;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform vec3 uAccent;
uniform vec3 uBg;
uniform float uRenderScale;
in vec3 vDir;
out vec4 fragColor;

`;
  return { frag: preamble + stripped };
}

export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly fadeMesh: THREE.Mesh;
  readonly liveMesh: THREE.Mesh;
  readonly photoMesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly liveMat: THREE.ShaderMaterial;
  private readonly photoMat: THREE.ShaderMaterial;
  private readonly photoCache = new Map<string, THREE.Texture>();
  private readonly photoVideoCache = new Map<string, PhotoVideoLoop>();
  private photoWant: string | null = null;
  private photoLoadGen = 0;
  private photoVideoUrl: string | null = null;
  private pluginMat: THREE.ShaderMaterial | null = null;
  private pluginId: string | null = null;
  private pluginFrag: string | null = null;
  private readonly pluginUbo = new Float32Array(VIZ_UBO.totalFloats);
  private pluginRenderScale = 1;
  private pluginExposeRenderScale = false;
  private viewportW = 16;
  private viewportH = 9;
  private viewportDpr = 1;
  private kind: BackdropKind = "none";
  private customFrag: string | null = null;
  /** the sky's animation clock, in shader seconds: integrates dt × current speed */
  private clock = 0;

  /** Seconds on the far-field clock (`uTime`). */
  skyTime(): number {
    return this.clock;
  }
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
  private morphT = 1;
  private lookOpacity = 1;
  private outgoingMat: THREE.ShaderMaterial | null = null;

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
    this.fadeMesh = new THREE.Mesh(this.mesh.geometry, this.mat);
    this.fadeMesh.frustumCulled = false;
    this.fadeMesh.renderOrder = -9;
    this.fadeMesh.visible = false;

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

    this.photoMat = new THREE.ShaderMaterial({
      uniforms: {
        uVideo: { value: blankTex() },
        uCanvas: { value: new THREE.Vector2(16, 9) },
        uVideoSize: { value: new THREE.Vector2(16, 9) },
        uOpacity: { value: 1 },
        uBright: { value: 1 },
        uAudio: { value: 0 },
        uLumaCap: { value: SKY_LUMA_CAP },
        uTime: { value: 0 },
        uAnimate: { value: 1 },
        uLoopMix: { value: 0 },
        uVideoB: { value: blankTex() },
        uBg: { value: new THREE.Color(0x0b0e14) },
      },
      vertexShader: LIVE_VERT,
      fragmentShader: PHOTO_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.photoMat);
    this.photoMesh.frustumCulled = false;
    this.photoMesh.renderOrder = -11;
    this.photoMesh.visible = false;
  }

  setKind(kind: BackdropKind): void {
    const prev = this.kind;
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
    if (kind !== prev) this.beginSkyMorph();
    this.kind = kind;
    const photo = isPhotoSky(kind);
    this.mesh.visible = kind !== "none" && kind !== "live" && !photo;
    this.liveMesh.visible = kind === "live";
    this.photoMesh.visible = photo;
    const modeKind = kind === "plugin" && !this.pluginMat ? PLUGIN_SKY_FALLBACK : kind;
    this.mat.uniforms.uMode.value = MODE_NUM[modeKind] ?? 0;
    if (kind === "dynamic") this.setRecipe(currentSkyRecipe());
    if (kind === "live" && liveCam.texture) {
      this.liveMat.uniforms.uVideo.value = liveCam.texture;
      this.liveMesh.visible = true;
    }
    if (photo) {
      if (kind !== prev) this.loadPhotoSky(kind as PhotoSkyKind);
    } else {
      this.pausePhotoVideos();
    }
  }

  /**
   * Compile a plugin ``sky/fragment.glsl`` onto the sphere. Returns a contract/compile
   * error, or null if the host accepted it. ``null`` source restores the shipped program.
   */
  setPluginShader(
    opts: { id: string; source: string } | null,
    gpuProbe?: () => string | null,
  ): string | null {
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
    const prevMat = this.mesh.material;
    this.ensurePluginMat(opts.id, wrapped.frag);
    const gpuErr = gpuProbe ? gpuProbe() : probePluginSkyCompile(wrapped.frag);
    if (this.kind !== "plugin") this.mesh.material = prevMat;
    if (gpuErr) {
      lastPlugin = null;
      this.pluginId = null;
      this.pluginFrag = null;
      this.dropPluginMat();
      if (this.kind === "plugin") this.setKind("plugin");
      return gpuErr;
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

  /** Load a photographic plate onto the full-screen sky (cover-fit, no webcam). */
  loadPhoto(url: string): void {
    this.loadPhotoStill(url, ++this.photoLoadGen);
  }

  /** Prefer a looping video plate, then the JPEG poster. Never opens the webcam. */
  loadPhotoSky(kind: PhotoSkyKind): void {
    const gen = ++this.photoLoadGen;
    this.tryPhotoSrc(photoSkyCandidates(kind), 0, gen);
  }

  private tryPhotoSrc(urls: string[], i: number, gen: number): void {
    if (gen !== this.photoLoadGen) return;
    const url = urls[i];
    if (!url) return;
    if (isPhotoVideoUrl(url)) {
      this.loadPhotoVideo(url, gen, () => this.tryPhotoSrc(urls, i + 1, gen));
      return;
    }
    this.loadPhotoStill(url, gen);
  }

  private loadPhotoStill(url: string, gen: number): void {
    this.photoWant = url;
    const hit = this.photoCache.get(url);
    if (hit) {
      if (gen !== this.photoLoadGen) return;
      this.bindPhoto(hit, true);
      return;
    }
    void loadHtmlImage(new Image(), url).then((img) => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      this.photoCache.set(url, t);
      if (gen !== this.photoLoadGen) return;
      this.bindPhoto(t, true);
    }).catch(() => undefined);
  }

  private loadPhotoVideo(url: string, gen: number, onMiss: () => void): void {
    const cached = this.photoVideoCache.get(url);
    if (cached && cached.slots[0].el.readyState >= 2 && cached.slots[0].el.videoWidth > 0) {
      if (gen !== this.photoLoadGen) return;
      this.bindPhotoVideo(cached);
      return;
    }
    const a = makeSkyVideo(url);
    const fail = (): void => {
      a.removeEventListener("error", fail);
      a.removeEventListener("loadeddata", ok);
      if (gen !== this.photoLoadGen) return;
      onMiss();
    };
    const ok = (): void => {
      a.removeEventListener("error", fail);
      a.removeEventListener("loadeddata", ok);
      if (gen !== this.photoLoadGen) return;
      if (a.videoWidth <= 0) {
        onMiss();
        return;
      }
      const b = makeSkyVideo(url);
      const pack: PhotoVideoLoop = {
        url,
        slots: [
          { el: a, tex: makeSkyVideoTex(a) },
          { el: b, tex: makeSkyVideoTex(b) },
        ],
        active: 0,
        incoming: false,
      };
      this.photoVideoCache.set(url, pack);
      this.bindPhotoVideo(pack);
    };
    a.addEventListener("error", fail);
    a.addEventListener("loadeddata", ok);
    a.load();
  }

  private bindPhotoVideo(pack: PhotoVideoLoop): void {
    this.photoWant = pack.url;
    this.photoVideoUrl = pack.url;
    this.pausePhotoVideos(pack.url);
    pack.active = 0;
    pack.incoming = false;
    const cur = pack.slots[0];
    const nxt = pack.slots[1];
    try { nxt.el.currentTime = 0; } catch { /* seek before metadata */ }
    nxt.el.pause();
    this.photoMat.uniforms.uAnimate.value = 0;
    this.photoMat.uniforms.uLoopMix.value = 0;
    this.photoMat.uniforms.uVideoB.value = nxt.tex;
    this.bindPhoto(cur.tex, false);
    try { cur.el.currentTime = 0; } catch { /* */ }
    const play = cur.el.play();
    if (play) void play.catch(() => undefined);
  }

  private pausePhotoVideos(except?: string): void {
    for (const [url, loop] of this.photoVideoCache) {
      if (url === except) continue;
      for (const slot of loop.slots) slot.el.pause();
    }
    if (!except) {
      this.photoVideoUrl = null;
      this.photoMat.uniforms.uLoopMix.value = 0;
    }
  }

  private tickPhotoVideoLoop(): void {
    const url = this.photoVideoUrl;
    if (!url) return;
    const pack = this.photoVideoCache.get(url);
    if (!pack) return;
    const cur = pack.slots[pack.active];
    const nxt = pack.slots[pack.active === 0 ? 1 : 0];
    const dur = cur.el.duration;
    if (cur.el.videoWidth > 0) {
      (this.photoMat.uniforms.uVideoSize.value as THREE.Vector2).set(cur.el.videoWidth, cur.el.videoHeight);
    }
    if (!Number.isFinite(dur) || dur <= PHOTO_LOOP_FADE_S * 2) {
      this.photoMat.uniforms.uLoopMix.value = 0;
      return;
    }
    const t = cur.el.ended ? dur : cur.el.currentTime;
    const mix = photoLoopMix(t, dur);
    this.photoMat.uniforms.uLoopMix.value = mix;
    this.photoMat.uniforms.uVideoB.value = nxt.tex;
    if (mix > 0 && !pack.incoming) {
      pack.incoming = true;
      try { nxt.el.currentTime = 0; } catch { /* */ }
      const play = nxt.el.play();
      if (play) void play.catch(() => undefined);
    }
    if (cur.el.ended || mix >= 0.97) {
      pack.active = pack.active === 0 ? 1 : 0;
      pack.incoming = false;
      cur.el.pause();
      try { cur.el.currentTime = 0; } catch { /* */ }
      this.photoMat.uniforms.uVideo.value = nxt.tex;
      this.photoMat.uniforms.uLoopMix.value = 0;
      if (nxt.el.paused) {
        const play = nxt.el.play();
        if (play) void play.catch(() => undefined);
      }
    }
  }

  private bindPhoto(t: THREE.Texture, animate: boolean): void {
    this.photoMat.uniforms.uVideo.value = t;
    this.photoMat.uniforms.uAnimate.value = animate ? 1 : 0;
    this.photoMat.uniforms.uLoopMix.value = 0;
    if (animate) {
      this.photoVideoUrl = null;
      this.photoMat.uniforms.uVideoB.value = t;
    }
    const img = t.image as {
      naturalWidth?: number;
      naturalHeight?: number;
      videoWidth?: number;
      videoHeight?: number;
      width?: number;
      height?: number;
    };
    const w = img.videoWidth || img.naturalWidth || img.width || 16;
    const h = img.videoHeight || img.naturalHeight || img.height || 9;
    (this.photoMat.uniforms.uVideoSize.value as THREE.Vector2).set(w, h);
  }

  private applyFrag(src: string): void {
    this.mat.fragmentShader = src;
    this.mat.needsUpdate = true;
  }

  /** Which pack-declared sky uniforms are active (e.g. uRenderScale). */
  setPluginSkyContract(uniforms: readonly string[] | undefined): void {
    this.pluginExposeRenderScale = !!uniforms?.includes("uRenderScale");
    this.syncPluginHostUniforms();
  }

  private pluginUniforms(): THREE.ShaderMaterial["uniforms"] {
    const u = this.mat.uniforms;
    return {
      uResolution: { value: new THREE.Vector2(16, 9) },
      uTime: { value: u.uTime.value },
      uOpacity: { value: u.uOpacity.value },
      uBright: { value: u.uBright.value },
      uAudio: { value: u.uAudio.value },
      uAccent: { value: (u.uAccent.value as THREE.Color).clone() },
      uBg: { value: (u.uBg.value as THREE.Color).clone() },
      uRenderScale: { value: 1 },
      [VIZ_UBO.threeUniform]: { value: this.pluginUbo },
    };
  }

  /** Host adaptive render scale (1 when governor inactive). */
  setPluginRenderScale(scale: number): void {
    const s = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
    if (Math.abs(s - this.pluginRenderScale) < 0.0005) return;
    this.pluginRenderScale = s;
    this.syncPluginHostUniforms();
  }

  private syncPluginHostUniforms(): void {
    const mat = this.pluginMat;
    if (!mat || this.mesh.material !== mat) return;
    const rw = Math.max(1, Math.floor(this.viewportW * this.viewportDpr * this.pluginRenderScale));
    const rh = Math.max(1, Math.floor(this.viewportH * this.viewportDpr * this.pluginRenderScale));
    const res = mat.uniforms.uResolution?.value as THREE.Vector2 | undefined;
    if (res) res.set(rw, rh);
    if (this.pluginExposeRenderScale) {
      const u = mat.uniforms.uRenderScale;
      if (u) u.value = this.pluginRenderScale;
    }
  }

  private ensurePluginMat(id: string, frag: string): void {
    if (this.pluginMat && this.pluginMat.fragmentShader === frag) {
      this.pluginId = id;
      this.pluginFrag = frag;
      this.mesh.material = this.pluginMat;
      return;
    }
    if (this.kind === "plugin" && this.pluginMat) this.beginSkyMorph();
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

  setViewport(w: number, h: number, dpr = 1): void {
    this.viewportW = Math.max(1, w);
    this.viewportH = Math.max(1, h);
    this.viewportDpr = Math.max(0.25, dpr);
    (this.liveMat.uniforms.uCanvas.value as THREE.Vector2).set(w, h);
    (this.photoMat.uniforms.uCanvas.value as THREE.Vector2).set(w, h);
    this.syncPluginHostUniforms();
  }

  setColors(accent: number, bg: number): void {
    (this.mat.uniforms.uAccent.value as THREE.Color).setHex(accent);
    (this.mat.uniforms.uBg.value as THREE.Color).setHex(bg);
    (this.liveMat.uniforms.uBg.value as THREE.Color).setHex(bg);
    (this.photoMat.uniforms.uBg.value as THREE.Color).setHex(bg);
    this.syncPluginLook();
  }

  setLumaCap(cap: number): void {
    const v = Math.min(SKY_LUMA_CAP, Math.max(0.04, cap));
    this.liveMat.uniforms.uLumaCap.value = v;
    this.photoMat.uniforms.uLumaCap.value = v;
  }

  setLook(opacity: number, brightness: number, audio: number): void {
    this.audio = audio;
    this.lookOpacity = opacity;
    this.mat.uniforms.uBright.value = brightness;
    this.mat.uniforms.uAudio.value = audio;
    this.liveMat.uniforms.uBright.value = brightness;
    this.liveMat.uniforms.uAudio.value = audio;
    this.photoMat.uniforms.uBright.value = brightness;
    this.photoMat.uniforms.uAudio.value = audio;
    this.syncPluginLook();
    this.applyMorphFade();
  }

  /** True while a sky / plugin-shader crossfade is in flight. */
  skyMorphing(): boolean {
    return this.morphT < 1;
  }

  private beginSkyMorph(): void {
    this.clearOutgoing();
    this.morphT = 0;
    if (!this.mesh.visible) return;
    const src = this.mesh.material as THREE.ShaderMaterial;
    if (!src?.uniforms?.uOpacity) return;
    this.outgoingMat = src.clone();
    this.outgoingMat.transparent = true;
    this.fadeMesh.material = this.outgoingMat;
    this.fadeMesh.visible = true;
  }

  private clearOutgoing(): void {
    this.fadeMesh.visible = false;
    if (this.outgoingMat) {
      this.outgoingMat.dispose();
      this.outgoingMat = null;
    }
    this.fadeMesh.material = this.mat;
  }

  private applyMorphFade(): void {
    const k = this.morphT >= 1 ? 1 : mixFade(this.morphT);
    const incoming = this.lookOpacity * k;
    const outgoing = this.lookOpacity * (1 - k);
    this.mat.uniforms.uOpacity.value = incoming;
    this.liveMat.uniforms.uOpacity.value = incoming;
    this.photoMat.uniforms.uOpacity.value = incoming;
    if (this.pluginMat) this.pluginMat.uniforms.uOpacity.value = incoming;
    if (this.outgoingMat) {
      this.outgoingMat.uniforms.uOpacity.value = outgoing;
      if (this.outgoingMat.uniforms.uTime) this.outgoingMat.uniforms.uTime.value = this.clock;
      this.fadeMesh.visible = outgoing > 0.008;
    }
    if (this.morphT >= 1) this.clearOutgoing();
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
  /**
   * Plugin skies treat vDir as a camera-local ray (Shadertoy-style). Parent the
   * dome to the camera so fragment.glsl yaw locks stay level; world skies stay
   * origin-locked so orbiting the graph still pans the backdrop.
   */
  syncCamera(camera: THREE.Camera): void {
    const plugin = !!(this.pluginMat && this.mesh.material === this.pluginMat);
    if (plugin) {
      this.mesh.position.copy(camera.position);
      this.mesh.quaternion.copy(camera.quaternion);
      this.fadeMesh.position.copy(camera.position);
      this.fadeMesh.quaternion.copy(camera.quaternion);
    } else {
      this.mesh.position.set(0, 0, 0);
      this.mesh.quaternion.identity();
      this.fadeMesh.position.set(0, 0, 0);
      this.fadeMesh.quaternion.identity();
    }
  }

  tick(t: number): void {
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, t - this.lastT)); // a hidden tab resumes without a leap
    this.lastT = t;
    if (this.kind === "none") return;
    const target = this.speed * (1 + this.audio * PULSE_ACCEL);
    const tau = 0.04 + EASE_MAX_S * this.ease * this.ease;
    this.curSpeed += (target - this.curSpeed) * (1 - Math.exp(-dt / tau));
    const frozenSky = smokeBackroomsSkyTime();
    if (frozenSky !== null) this.clock = frozenSky;
    else this.clock += dt * this.curSpeed;
    this.mat.uniforms.uTime.value = this.clock;
    this.photoMat.uniforms.uTime.value = this.clock;
    this.syncPluginLook();
    if (this.morphT < 1) {
      this.morphT = Math.min(1, this.morphT + dt / VIEW_MORPH_S);
      this.applyMorphFade();
    }
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
    } else if (this.photoVideoUrl) {
      this.tickPhotoVideoLoop();
    }
  }
}
