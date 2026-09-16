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
  float aa = min(fwidth(p.x) + fwidth(p.y), 0.08);
  float w = 0.014 + uAudio * 0.03;
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
  float dist = length(vWorld.xz);
  float fade = 1.0 - smoothstep(480.0, 1220.0, dist);
  float a = line * uOpacity * fade;
  if (a < 0.01) discard;
  vec3 col = mix(uMinor, uMajor, uShape < 0.5 ? clamp(major, 0.0, 1.0) : 0.85);
  col *= uBright * (1.0 + uAudio * 1.5);
  col = capSkyLumaTo(col, uLumaCap);
  fragColor = vec4(col, a);
}
`;

const SHAPE_NUM: Record<FloorShape, number> = {
  square: 0, hex: 1, triangle: 2, diamond: 3, circle: 4,
};

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
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), this.mat);
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
    this.mat.uniforms.uOpacity.value = opacity;
    this.mat.uniforms.uBright.value = brightness;
    this.mat.uniforms.uAudio.value = audio;
    this.mat.uniforms.uCell.value = cell;
    this.mat.uniforms.uShape.value = SHAPE_NUM[shape];
    this.mesh.visible = opacity > 0.008;
  }

  setLumaCap(cap: number): void {
    this.mat.uniforms.uLumaCap.value = Math.min(SKY_LUMA_CAP, Math.max(0.04, cap));
  }
}
