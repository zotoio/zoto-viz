import * as THREE from "three";
import { SKY_LUMA_CAP, SKY_LUMA_CAP_GLSL } from "../core/themes";

/**
 * Floor under the graph: a faded tiled plane. Colour, cell size, and tile shape (square / hex /
 * triangle / diamond / circle) are uniforms so the settings cog can retile without rebuilding geometry.
 */

export type FloorShape = "square" | "hex" | "triangle" | "diamond" | "circle";

export const FLOOR_SHAPES: { value: FloorShape; label: string; hint: string }[] = [
  { value: "square", label: "square", hint: "cartesian grid" },
  { value: "hex", label: "hexagon", hint: "honeycomb" },
  { value: "triangle", label: "triangle", hint: "three-way lines" },
  { value: "diamond", label: "diamond", hint: "isometric" },
  { value: "circle", label: "circle", hint: "packed rings" },
];

const VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uMajor;
uniform vec3 uMinor;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform float uCell;
uniform float uShape;
uniform float uLumaCap;
uniform vec2 uCenter;
uniform float uFadeFar;
in vec3 vWorld;
out vec4 fragColor;

${SKY_LUMA_CAP_GLSL}

float line1(float x, float w, float aa) {
  float d = abs(fract(x + 0.5) - 0.5);
  return 1.0 - smoothstep(w, w + aa, d);
}

float hexSDF(vec2 p) {
  vec2 q = abs(p);
  return max(q.x * 0.8660254 + q.y * 0.5, q.y);
}

vec2 hexGV(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - 0.5 * s;
  vec2 b = mod(p - vec2(0.5, 0.8660254), s) - 0.5 * s;
  return dot(a, a) < dot(b, b) ? a : b;
}

void main() {
  float cell = max(uCell, 8.0);
  vec2 p = vWorld.xz / cell;
  float aa = clamp(fwidth(p.x) + fwidth(p.y), 0.01, 0.03);
  float w = 0.014 + uAudio * 0.02;
  float line = 0.0;
  float major = 0.0;
  if (uShape < 0.5) {
    float minor = max(line1(p.x, w, aa), line1(p.y, w, aa));
    major = max(line1(p.x * 0.25, w, aa), line1(p.y * 0.25, w, aa));
    line = max(minor * 0.55, major);
  } else if (uShape < 1.5) {
    // Voronoi hexagon of this lattice has apothem √3/4, not 0.5 (0.5 overlaps and draws triangles).
    float edge = abs(hexSDF(hexGV(p)) - 0.4330127);
    line = 1.0 - smoothstep(w, w + aa, edge);
  } else if (uShape < 2.5) {
    line = max(line1(p.x, w, aa), max(
      line1(p.x * 0.5 + p.y * 0.8660254, w, aa),
      line1(-p.x * 0.5 + p.y * 0.8660254, w, aa)
    ));
  } else if (uShape < 3.5) {
    vec2 q = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
    line = max(line1(q.x, w, aa), line1(q.y, w, aa));
  } else {
    float edge = abs(length(hexGV(p)) - 0.38);
    line = 1.0 - smoothstep(w, w + aa, edge);
  }
  float dist = length(vWorld.xz - uCenter);
  float fade = 1.0 - smoothstep(uFadeFar * 0.4, max(uFadeFar, 8.0), dist);
  float a = line * uOpacity * fade;
  if (a < 0.002) discard;
  vec3 col = mix(uMinor, uMajor, uShape < 0.5 ? clamp(major, 0.0, 1.0) : 0.85);
  col *= uBright * (1.0 + uAudio * 1.5);
  col = capSkyLumaTo(col, uLumaCap);
  fragColor = vec4(col, a);
}
`;

const SHAPE_NUM: Record<FloorShape, number> = {
  square: 0, hex: 1, triangle: 2, diamond: 3, circle: 4,
};

/** PlaneGeometry edge length. Scale 1 → this many world units. */
export const FLOOR_PLANE = 2400;

export type FloorFocus = { x: number; y: number; z: number; hx: number; hz: number; n: number };

export type FloorPose = {
  x: number; y: number; z: number;
  scaleX: number; scaleZ: number;
  fadeFar: number;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** World-fixed floor from before graph-follow (origin plane, wide fade). */
export function worldFloorPose(spreadX = 1): FloorPose {
  return {
    x: 0,
    y: -320,
    z: 0,
    scaleX: Math.max(1, spreadX * 1.15),
    scaleZ: 1,
    fadeFar: 1220,
  };
}

function gluedFloorPose(graph: FloorFocus): FloorPose {
  const has = graph.n > 0;
  const span = Math.max(has ? graph.hx : 280, has ? graph.hz : 280, 160);
  const cover = (span * 2.6) / (FLOOR_PLANE * 0.5);
  const scale = Math.max(cover, 0.45);
  return {
    x: has ? graph.x : 0,
    y: (has ? graph.y : 0) - Math.min(240, Math.max(90, span * 0.28)),
    z: has ? graph.z : 0,
    scaleX: scale,
    scaleZ: scale,
    fadeFar: span * 2.35,
  };
}

/**
 * Blend a world-fixed floor (`follow` 0) into a floor that sits under the
 * live graph (`follow` 1). Tile pattern stays world-locked either way.
 */
export function floorPose(graph: FloorFocus, follow = 1, spreadX = 1): FloorPose {
  const t = clamp01(follow);
  const world = worldFloorPose(spreadX);
  if (t <= 0) return world;
  const glued = gluedFloorPose(graph);
  if (t >= 1) return glued;
  return {
    x: lerp(world.x, glued.x, t),
    y: lerp(world.y, glued.y, t),
    z: lerp(world.z, glued.z, t),
    scaleX: lerp(world.scaleX, glued.scaleX, t),
    scaleZ: lerp(world.scaleZ, glued.scaleZ, t),
    fadeFar: lerp(world.fadeFar, glued.fadeFar, t),
  };
}

function holdOrLerp(cur: number, want: number, k: number, rel: number): number {
  if (Math.abs(want - cur) < Math.max(1e-3, Math.abs(cur) * rel)) return cur;
  return lerp(cur, want, k);
}

/** Ease the live pose; keep height / scale / fade still unless they moved by a real step. */
export function easeFloorPose(cur: FloorPose, want: FloorPose, k: number): FloorPose {
  const t = clamp01(k);
  const slow = t * 0.45;
  return {
    x: lerp(cur.x, want.x, t),
    y: holdOrLerp(cur.y, want.y, slow, 0.08),
    z: lerp(cur.z, want.z, t),
    scaleX: holdOrLerp(cur.scaleX, want.scaleX, slow, 0.14),
    scaleZ: holdOrLerp(cur.scaleZ, want.scaleZ, slow, 0.14),
    fadeFar: holdOrLerp(cur.fadeFar, want.fadeFar, slow, 0.14),
  };
}

export class FloorGrid {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMajor: { value: new THREE.Color(0x1a2030) },
        uMinor: { value: new THREE.Color(0x141a26) },
        uOpacity: { value: 0.7 },
        uBright: { value: 1 },
        uAudio: { value: 0 },
        uCell: { value: 50 },
        uShape: { value: 0 },
        uLumaCap: { value: SKY_LUMA_CAP },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uFadeFar: { value: 1220 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_PLANE, FLOOR_PLANE), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = -320;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
  }

  setColors(major: number, minor: number): void {
    (this.mat.uniforms.uMajor.value as THREE.Color).setHex(major);
    (this.mat.uniforms.uMinor.value as THREE.Color).setHex(minor);
  }

  setLook(opacity: number, brightness: number, audio: number, cell: number, shape: FloorShape): void {
    const k = 0.18;
    const prevOp = this.mat.uniforms.uOpacity.value as number;
    const prevBr = this.mat.uniforms.uBright.value as number;
    const prevAu = this.mat.uniforms.uAudio.value as number;
    const nextOp = prevOp + (opacity - prevOp) * k;
    this.mat.uniforms.uOpacity.value = nextOp;
    this.mat.uniforms.uBright.value = prevBr + (brightness - prevBr) * k;
    this.mat.uniforms.uAudio.value = prevAu + (audio - prevAu) * k;
    this.mat.uniforms.uCell.value = cell;
    this.mat.uniforms.uShape.value = SHAPE_NUM[shape];
    if (nextOp > 0.012) this.mesh.visible = true;
    else if (nextOp < 0.003) this.mesh.visible = false;
  }

  setLumaCap(cap: number): void {
    this.mat.uniforms.uLumaCap.value = Math.min(SKY_LUMA_CAP, Math.max(0.04, cap));
  }

  setPose(p: FloorPose): void {
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.scale.set(p.scaleX, p.scaleZ, 1);
    (this.mat.uniforms.uCenter.value as THREE.Vector2).set(p.x, p.z);
    this.mat.uniforms.uFadeFar.value = p.fadeFar;
  }

  copyPose(src: FloorGrid): void {
    this.mesh.position.copy(src.mesh.position);
    this.mesh.scale.copy(src.mesh.scale);
    (this.mat.uniforms.uCenter.value as THREE.Vector2).copy(src.mat.uniforms.uCenter.value as THREE.Vector2);
    this.mat.uniforms.uFadeFar.value = src.mat.uniforms.uFadeFar.value;
  }
}
