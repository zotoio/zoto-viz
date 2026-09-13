import * as THREE from "three";
import { liveCam } from "../camera/livecam";

/**
 * Far-field sky behind the graph: a huge inward sphere around the origin so orbiting the network
 * reads as flying through space / rain / a fractal, while the device cloud stays in the foreground.
 *
 *   none     hide the mesh
 *   fractal  slow Julia set on the sky
 *   space    hashed starfield + a faint nebula
 *   matrix   falling glyph columns on the sphere
 *   live     the device camera, object-fit cover on a fullscreen quad
 */

export type BackdropKind = "none" | "fractal" | "space" | "matrix" | "live";

export const BACKDROP_OPTIONS: { value: BackdropKind; label: string; hint: string }[] = [
  { value: "none", label: "none", hint: "plain fog" },
  { value: "fractal", label: "fractal", hint: "slow Julia set" },
  { value: "space", label: "space", hint: "starfield" },
  { value: "matrix", label: "matrix", hint: "falling code" },
  { value: "live", label: "live", hint: "this machine's camera" },
];

/** Skies the dream / randomize pool picks from (not none). */
export const CYCLE_SKIES: BackdropKind[] = ["fractal", "space", "matrix", "live"];

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
  // 5x7 bitmap with a 1px gutter so columns read as glyphs, not bars.
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

void main() {
  vec3 dir = normalize(vDir);
  float t = uTime; // the sky's own clock: speed slider and pulse are integrated on the CPU, so the picture never jumps
  vec3 col;
  if (uMode < 1.5) col = fractal(dir, t);
  else if (uMode < 2.5) col = space(dir, t);
  else col = matrixRain(dir, t);
  fragColor = vec4(col * uBright, uOpacity);
}
`;

const MODE_NUM: Record<BackdropKind, number> = { none: 0, fractal: 1, space: 2, matrix: 3, live: 4 };

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
in vec2 vUv;
out vec4 fragColor;

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
  fragColor = vec4(col, uOpacity);
}
`;

/** how much the pulse accelerates the sky at full level (a 1.0 pulse runs the clock 3.4× the slider speed) */
const PULSE_ACCEL = 2.4;
/** the easing slider maps 0..1 onto this many seconds of time constant (quadratic, so the low end stays crisp) */
const EASE_MAX_S = 3;

export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly liveMesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly liveMat: THREE.ShaderMaterial;
  private kind: BackdropKind = "none";
  /** the sky's animation clock, in shader seconds: integrates dt × current speed */
  private clock = 0;
  /** speed multiplier the clock is running at now; eases toward speed × (1 + pulse × PULSE_ACCEL) */
  private curSpeed = 1;
  private speed = 1;
  private ease = 0.4;
  private audio = 0;
  private lastT: number | null = null;

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
    this.kind = kind;
    this.mesh.visible = kind !== "none" && kind !== "live";
    this.liveMesh.visible = kind === "live";
    this.mat.uniforms.uMode.value = MODE_NUM[kind] ?? 0;
    if (kind === "live" && liveCam.texture) {
      this.liveMat.uniforms.uVideo.value = liveCam.texture;
      this.liveMesh.visible = true;
    }
  }

  setViewport(w: number, h: number): void {
    (this.liveMat.uniforms.uCanvas.value as THREE.Vector2).set(w, h);
  }

  setColors(accent: number, bg: number): void {
    (this.mat.uniforms.uAccent.value as THREE.Color).setHex(accent);
    (this.mat.uniforms.uBg.value as THREE.Color).setHex(bg);
  }

  setLook(opacity: number, brightness: number, audio: number): void {
    this.audio = audio;
    this.mat.uniforms.uOpacity.value = opacity;
    this.mat.uniforms.uBright.value = brightness;
    this.mat.uniforms.uAudio.value = audio;
    this.liveMat.uniforms.uOpacity.value = opacity;
    this.liveMat.uniforms.uBright.value = brightness;
    this.liveMat.uniforms.uAudio.value = audio;
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
