import * as THREE from "three";
import { mixFade } from "./morph";

/** How the graph is drawn as a living surface. `off` keeps spheres + line segments. */
export const FABRIC_KINDS = ["off", "tubes", "cloth", "ribbon"] as const;
export type FabricKind = (typeof FABRIC_KINDS)[number];

export const FABRIC_OPTIONS: { value: FabricKind; label: string; hint: string }[] = [
  { value: "off", label: "off", hint: "classic spheres and line edges" },
  { value: "tubes", label: "tubes", hint: "nodes and edges become a tubular mesh; same hover / selection / glow" },
  { value: "cloth", label: "cloth", hint: "tubes plus triangle-cycle panels that billow as fabric" },
  { value: "ribbon", label: "ribbon", hint: "flat ribbons along edges with disc knots at nodes" },
];

export function parseFabric(raw: unknown): FabricKind | undefined {
  if (raw === true) return "tubes";
  if (raw === false) return "off";
  if (typeof raw === "string" && (FABRIC_KINDS as readonly string[]).includes(raw)) {
    return raw as FabricKind;
  }
  return undefined;
}

export function fabricActive(kind: FabricKind | undefined): boolean {
  return !!kind && kind !== "off";
}

/** Plugin style wins; otherwise the settings / look pin. */
export function resolveFabric(
  mode?: FabricKind | false | null,
  anim?: FabricKind | boolean | null,
): FabricKind {
  if (mode && mode !== "off") return mode;
  if (anim === true) return "tubes";
  if (typeof anim === "string" && anim !== "off" && (FABRIC_KINDS as readonly string[]).includes(anim)) {
    return anim;
  }
  return "off";
}

/** Same boost the sphere instances use for selected / hovered / active / idle. */
export function nodeHighlightBoost(selected: boolean, hovered: boolean, active: boolean): number {
  return selected ? 1.1 : hovered ? 0.7 : active ? 0.45 : 0.12;
}

/** Same selection dimming the line pass uses. */
export function edgeHighlightBright(
  base: number,
  selectedIncident: boolean,
  hasSelection: boolean,
  visible: boolean,
): number {
  if (!visible) return 0;
  let bright = base;
  if (selectedIncident) bright = Math.max(bright, 0.9);
  else if (hasSelection) bright *= 0.35;
  return bright;
}

/** Undirected 3-cycles, smallest-id-first, capped. */
export function graphFaces(pairs: readonly [string, string][], max = 80): [string, string, string][] {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (a === b) return;
    let s = adj.get(a);
    if (!s) { s = new Set(); adj.set(a, s); }
    s.add(b);
  };
  for (const [a, b] of pairs) {
    add(a, b);
    add(b, a);
  }
  const faces: [string, string, string][] = [];
  const seen = new Set<string>();
  const nodes = [...adj.keys()].sort();
  for (const a of nodes) {
    const na = [...(adj.get(a) ?? [])].filter((b) => b > a).sort();
    for (let i = 0; i < na.length; i++) {
      const b = na[i]!;
      const nb = adj.get(b);
      if (!nb) continue;
      for (let j = i + 1; j < na.length; j++) {
        const c = na[j]!;
        if (!nb.has(c)) continue;
        const key = `${a}|${b}|${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push([a, b, c]);
        if (faces.length >= max) return faces;
      }
    }
  }
  return faces;
}

export interface FabricNodePose {
  id: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  r: number;
  g: number;
  b: number;
  glow: number;
  opacity: number;
  visible: boolean;
}

export interface FabricEdgePose {
  a: string;
  b: string;
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  gab: number;
  gba: number;
  wave: number;
  visible: boolean;
}

export interface FabricSyncOpts {
  time: number;
  pulse: number;
  glowMode: "off" | "comet" | "pulse";
  glowAmt: number;
  glowSpeed: number;
  additive: boolean;
  /** 0–1 view-morph ease; fades and blends tube / cloth / ribbon. */
  morph?: number;
}

const NODE_LON = 8;
const NODE_LAT = 5;
const TUBE_ALONG = 7;
const TUBE_RADIAL = 6;
const RIBBON_ALONG = 9;
const FACE_DIV = 2;
const MAX_NODES = 160;
const MAX_EDGES = 280;
const MAX_FACES = 64;

function nodeVertCount(): number {
  return (NODE_LAT + 1) * (NODE_LON + 1);
}

function nodeIndexCount(): number {
  return NODE_LAT * NODE_LON * 6;
}

function tubeVertCount(): number {
  return TUBE_ALONG * TUBE_RADIAL;
}

function tubeIndexCount(): number {
  return (TUBE_ALONG - 1) * TUBE_RADIAL * 6;
}

function ribbonVertCount(): number {
  return RIBBON_ALONG * 2;
}

function ribbonIndexCount(): number {
  return (RIBBON_ALONG - 1) * 2 * 3;
}

function faceVertCount(): number {
  let n = 0;
  for (let i = 0; i <= FACE_DIV; i++) n += FACE_DIV - i + 1;
  return n;
}

function faceIndexCount(): number {
  let n = 0;
  for (let i = 0; i < FACE_DIV; i++) {
    const row = FACE_DIV - i;
    n += row * 3 + (row - 1) * 3;
  }
  return n;
}

function discVertCount(): number {
  return NODE_LON + 1;
}

function discIndexCount(): number {
  return NODE_LON * 3;
}

export function fabricCapacity(kind: FabricKind, nNodes: number, nEdges: number, nFaces: number): { verts: number; indices: number } {
  const nodes = Math.min(nNodes, MAX_NODES);
  const edges = Math.min(nEdges, MAX_EDGES);
  const faces = kind === "cloth" ? Math.min(nFaces, MAX_FACES) : 0;
  if (kind === "ribbon") {
    return {
      verts: nodes * discVertCount() + edges * ribbonVertCount(),
      indices: nodes * discIndexCount() + edges * ribbonIndexCount(),
    };
  }
  return {
    verts: nodes * nodeVertCount() + edges * tubeVertCount() + faces * faceVertCount(),
    indices: nodes * nodeIndexCount() + edges * tubeIndexCount() + faces * faceIndexCount(),
  };
}

function frame(dx: number, dy: number, dz: number): { n: [number, number, number]; b: [number, number, number] } {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(dy) > 0.92) { ux = 1; uy = 0; }
  let nx = dy * uz - dz * uy, ny = dz * ux - dx * uz, nz = dx * uy - dy * ux;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  return { n: [nx, ny, nz], b: [dy * nz - dz * ny, dz * nx - dx * nz, dx * ny - dy * nx] };
}

const FABRIC_GLSL = `
attribute float aAlong;
attribute float aKind;
attribute float aGlow;
attribute float aWave;
attribute float aGab;
attribute float aGba;
attribute float aAlpha;
varying float vGlow;
varying float vAlpha;
uniform float uTime;
uniform float uPulse;
uniform float uGlowAmt;
uniform float uGlowSpeed;
uniform float uGlowMode;
uniform float uKind;

float comet(float along, float phase) {
  float behind = fract(phase - along);
  return exp(-behind * 3.6);
}
float pulse(float along, float phase) {
  return 0.35 + 0.65 * 0.5 * (1.0 + sin((along - phase) * 6.2831853));
}
`;

function fabricMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.32,
    metalness: 0.22,
    transparent: true,
    vertexColors: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPulse = { value: 0 };
    shader.uniforms.uGlowAmt = { value: 1 };
    shader.uniforms.uGlowSpeed = { value: 1 };
    shader.uniforms.uGlowMode = { value: 0 };
    shader.uniforms.uKind = { value: 0 };
    (mat.userData as { uniforms?: typeof shader.uniforms }).uniforms = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FABRIC_GLSL}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float wave = 0.0;
if (aKind < 0.5) {
  wave = 0.32 * aGlow * sin(uTime * 2.3 + aAlong * 4.0);
  if (uKind > 0.5) wave *= 1.25;
} else if (aKind < 1.5) {
  wave = aWave * sin(aAlong * 12.0 - uTime * 2.8);
} else {
  wave = (0.22 + 0.18 * uPulse) * sin(uTime * 1.35 + aAlong * 6.4);
}
transformed += normalize(objectNormal) * wave;
float cometGlow = 0.0;
if (aGab > 0.001) {
  float phase = fract(uTime * uGlowSpeed * (0.40 + 0.70 * aGab));
  cometGlow += aGab * (uGlowMode < 0.5 ? comet(aAlong, phase) : pulse(aAlong, phase));
}
if (aGba > 0.001) {
  float phase = fract(uTime * uGlowSpeed * (0.40 + 0.70 * aGba));
  cometGlow += aGba * (uGlowMode < 0.5 ? comet(1.0 - aAlong, phase) : pulse(1.0 - aAlong, phase));
}
vGlow = aGlow + cometGlow * uGlowAmt;
vAlpha = aAlpha;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nvarying float vAlpha;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vAlpha;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * vGlow;");
  };
  return mat;
}

type Writer = {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  along: Float32Array;
  kind: Float32Array;
  glow: Float32Array;
  wave: Float32Array;
  gab: Float32Array;
  gba: Float32Array;
  alpha: Float32Array;
  idx: Uint32Array;
  vi: number;
  ii: number;
};

function writeVert(
  w: Writer,
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  r: number, g: number, b: number,
  along: number, kind: number, glow: number, wave: number, gab: number, gba: number, alpha: number,
): number {
  const i = w.vi++;
  const p = i * 3;
  w.pos[p] = x; w.pos[p + 1] = y; w.pos[p + 2] = z;
  w.nrm[p] = nx; w.nrm[p + 1] = ny; w.nrm[p + 2] = nz;
  w.col[p] = r; w.col[p + 1] = g; w.col[p + 2] = b;
  w.along[i] = along;
  w.kind[i] = kind;
  w.glow[i] = glow;
  w.wave[i] = wave;
  w.gab[i] = gab;
  w.gba[i] = gba;
  w.alpha[i] = alpha;
  return i;
}

function writeTri(w: Writer, a: number, b: number, c: number): void {
  w.idx[w.ii++] = a;
  w.idx[w.ii++] = b;
  w.idx[w.ii++] = c;
}

function writeNodeHub(w: Writer, n: FabricNodePose): void {
  const base = w.vi;
  const s = Math.max(0.4, n.scale);
  for (let i = 0; i <= NODE_LAT; i++) {
    const v = i / NODE_LAT;
    const phi = v * Math.PI;
    const sy = Math.cos(phi);
    const xr = Math.sin(phi);
    for (let j = 0; j <= NODE_LON; j++) {
      const u = j / NODE_LON;
      const th = u * Math.PI * 2;
      const nx = xr * Math.cos(th);
      const nz = xr * Math.sin(th);
      writeVert(w, n.x + nx * s, n.y + sy * s, n.z + nz * s, nx, sy, nz, n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity);
    }
  }
  const stride = NODE_LON + 1;
  for (let i = 0; i < NODE_LAT; i++) {
    for (let j = 0; j < NODE_LON; j++) {
      const a = base + i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      writeTri(w, a, c, b);
      writeTri(w, b, c, d);
    }
  }
}

function writeNodeDisc(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.5, n.scale * 0.95);
  const c = writeVert(w, n.x, n.y, n.z, 0, 1, 0, n.r, n.g, n.b, 0.5, 0, n.glow, 0, 0, 0, n.opacity);
  for (let j = 0; j < NODE_LON; j++) {
    const u = j / NODE_LON;
    const th = u * Math.PI * 2;
    const nx = Math.cos(th), nz = Math.sin(th);
    writeVert(w, n.x + nx * s, n.y, n.z + nz * s, 0, 1, 0, n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity);
  }
  for (let j = 0; j < NODE_LON; j++) {
    writeTri(w, c, c + 1 + j, c + 1 + ((j + 1) % NODE_LON));
  }
}

function writeTube(w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { n, b: bin } = frame(dx, dy, dz);
  const base = w.vi;
  for (let s = 0; s < TUBE_ALONG; s++) {
    const t = s / (TUBE_ALONG - 1);
    const cx = a.x + dx * t, cy = a.y + dy * t, cz = a.z + dz * t;
    const rad = Math.max(0.55, (a.scale * (1 - t) + b.scale * t) * 0.42);
    const r = a.r + (b.r - a.r) * t;
    const g = a.g + (b.g - a.g) * t;
    const bl = a.b + (b.b - a.b) * t;
    const glow = a.glow + (b.glow - a.glow) * t;
    const alpha = Math.min(a.opacity, b.opacity);
    for (let k = 0; k < TUBE_RADIAL; k++) {
      const ang = (k / TUBE_RADIAL) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const nx = n[0] * ca + bin[0] * sa;
      const ny = n[1] * ca + bin[1] * sa;
      const nz = n[2] * ca + bin[2] * sa;
      writeVert(
        w, cx + nx * rad, cy + ny * rad, cz + nz * rad, nx, ny, nz,
        r * 0.35 + e.r0 * 0.65 + (e.r1 - e.r0) * t * 0.65,
        g * 0.35 + e.g0 * 0.65 + (e.g1 - e.g0) * t * 0.65,
        bl * 0.35 + e.b0 * 0.65 + (e.b1 - e.b0) * t * 0.65,
        t, 1, glow, e.wave, e.gab, e.gba, alpha,
      );
    }
  }
  for (let s = 0; s < TUBE_ALONG - 1; s++) {
    for (let k = 0; k < TUBE_RADIAL; k++) {
      const i0 = base + s * TUBE_RADIAL + k;
      const i1 = base + s * TUBE_RADIAL + (k + 1) % TUBE_RADIAL;
      const i2 = base + (s + 1) * TUBE_RADIAL + k;
      const i3 = base + (s + 1) * TUBE_RADIAL + (k + 1) % TUBE_RADIAL;
      writeTri(w, i0, i2, i1);
      writeTri(w, i1, i2, i3);
    }
  }
}

function writeRibbon(w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { b: bin } = frame(dx, dy, dz);
  const base = w.vi;
  for (let s = 0; s < RIBBON_ALONG; s++) {
    const t = s / (RIBBON_ALONG - 1);
    const cx = a.x + dx * t, cy = a.y + dy * t, cz = a.z + dz * t;
    const half = Math.max(0.28, (a.scale * (1 - t) + b.scale * t) * 0.55);
    const r = a.r * 0.4 + e.r0 * 0.6 + (e.r1 - e.r0) * t * 0.6;
    const g = a.g * 0.4 + e.g0 * 0.6 + (e.g1 - e.g0) * t * 0.6;
    const bl = a.b * 0.4 + e.b0 * 0.6 + (e.b1 - e.b0) * t * 0.6;
    const glow = a.glow + (b.glow - a.glow) * t;
    const alpha = Math.min(a.opacity, b.opacity);
    writeVert(w, cx + bin[0] * half, cy + bin[1] * half, cz + bin[2] * half, 0, 1, 0, r, g, bl, t, 1, glow, e.wave, e.gab, e.gba, alpha);
    writeVert(w, cx - bin[0] * half, cy - bin[1] * half, cz - bin[2] * half, 0, 1, 0, r, g, bl, t, 1, glow, e.wave, e.gab, e.gba, alpha);
  }
  for (let s = 0; s < RIBBON_ALONG - 1; s++) {
    const i0 = base + s * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
    writeTri(w, i0, i2, i1);
    writeTri(w, i1, i2, i3);
  }
}

function baryIndex(i: number, j: number): number {
  let idx = 0;
  for (let r = 0; r < i; r++) idx += FACE_DIV - r + 1;
  return idx + j;
}

function writeFace(w: Writer, a: FabricNodePose, b: FabricNodePose, c: FabricNodePose): void {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const base = w.vi;
  const alpha = Math.min(a.opacity, b.opacity, c.opacity) * 0.72;
  for (let i = 0; i <= FACE_DIV; i++) {
    for (let j = 0; j <= FACE_DIV - i; j++) {
      const u = i / FACE_DIV, v = j / FACE_DIV, ww = 1 - u - v;
      const x = a.x * ww + b.x * u + c.x * v;
      const y = a.y * ww + b.y * u + c.y * v;
      const z = a.z * ww + b.z * u + c.z * v;
      writeVert(
        w, x, y, z, nx, ny, nz,
        a.r * ww + b.r * u + c.r * v,
        a.g * ww + b.g * u + c.g * v,
        a.b * ww + b.b * u + c.b * v,
        (u + v) * 0.5, 2,
        a.glow * ww + b.glow * u + c.glow * v,
        0.35, 0, 0, alpha,
      );
    }
  }
  for (let i = 0; i < FACE_DIV; i++) {
    const row = FACE_DIV - i;
    for (let j = 0; j < row; j++) {
      const p0 = base + baryIndex(i, j);
      const p1 = base + baryIndex(i + 1, j);
      const p2 = base + baryIndex(i, j + 1);
      writeTri(w, p0, p1, p2);
      if (j < row - 1) {
        const p3 = base + baryIndex(i + 1, j + 1);
        writeTri(w, p1, p3, p2);
      }
    }
  }
}

function signature(kind: FabricKind, nodes: FabricNodePose[], edges: FabricEdgePose[]): string {
  let s = kind + ":" + nodes.length + ":" + edges.length;
  for (const n of nodes) s += n.id + (n.visible ? "1" : "0");
  for (const e of edges) s += e.a + e.b + (e.visible ? "1" : "0");
  return s;
}

/**
 * Animated mesh whose vertices are the graph: node hubs, edge tubes/ribbons,
 * and (cloth) triangle-cycle panels. Vertex colours and glow follow the same
 * highlight pass as the sphere / line graph.
 */
export class GraphFabric {
  readonly mesh: THREE.Mesh;
  private readonly mat = fabricMaterial();
  private kind: FabricKind = "off";
  private kindN = 0;
  private kindFromN = 0;
  private sig = "";
  private pos = new Float32Array(0);
  private nrm = new Float32Array(0);
  private col = new Float32Array(0);
  private along = new Float32Array(0);
  private kindAttr = new Float32Array(0);
  private glow = new Float32Array(0);
  private wave = new Float32Array(0);
  private gab = new Float32Array(0);
  private gba = new Float32Array(0);
  private alpha = new Float32Array(0);
  private idx = new Uint32Array(0);
  private verts = 0;
  private indices = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  setKind(kind: FabricKind): void {
    if (this.kind === kind) return;
    this.kindFromN = this.kindN;
    this.kind = kind;
    this.kindN = kind === "cloth" ? 1 : kind === "ribbon" ? 2 : 0;
    this.sig = "";
    this.mesh.visible = fabricActive(kind);
  }

  sync(nodes: FabricNodePose[], edges: FabricEdgePose[], faces: [string, string, string][], opts: FabricSyncOpts): void {
    if (!fabricActive(this.kind)) {
      this.mesh.visible = false;
      return;
    }
    const visNodes = nodes.filter((n) => n.visible).slice(0, MAX_NODES);
    const visEdges = edges.filter((e) => e.visible).slice(0, MAX_EDGES);
    const byId = new Map(visNodes.map((n) => [n.id, n]));
    const visFaces = this.kind === "cloth"
      ? faces.filter(([a, b, c]) => byId.has(a) && byId.has(b) && byId.has(c)).slice(0, MAX_FACES)
      : [];
    const sig = signature(this.kind, visNodes, visEdges) + ":" + visFaces.length;
    if (sig !== this.sig) {
      this.rebuild(visNodes, visEdges, visFaces, byId);
      this.sig = sig;
    } else {
      this.rebuild(visNodes, visEdges, visFaces, byId);
    }
    const u = (this.mat.userData as { uniforms?: Record<string, { value: number }> }).uniforms;
    const k = mixFade(opts.morph ?? 1);
    if (u) {
      u.uTime.value = opts.time;
      u.uPulse.value = opts.pulse;
      u.uGlowAmt.value = opts.glowMode === "off" ? 0 : opts.glowAmt;
      u.uGlowSpeed.value = opts.glowSpeed;
      u.uGlowMode.value = opts.glowMode === "pulse" ? 1 : 0;
      u.uKind.value = this.kindFromN + (this.kindN - this.kindFromN) * k;
    }
    this.mat.opacity = 0.22 + 0.78 * k;
    this.mesh.scale.setScalar(0.86 + 0.14 * k);
    this.mat.blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mesh.visible = this.verts > 0;
  }

  private ensure(verts: number, indices: number): Writer {
    if (this.pos.length < verts * 3) {
      this.pos = new Float32Array(verts * 3);
      this.nrm = new Float32Array(verts * 3);
      this.col = new Float32Array(verts * 3);
      this.along = new Float32Array(verts);
      this.kindAttr = new Float32Array(verts);
      this.glow = new Float32Array(verts);
      this.wave = new Float32Array(verts);
      this.gab = new Float32Array(verts);
      this.gba = new Float32Array(verts);
      this.alpha = new Float32Array(verts);
    }
    if (this.idx.length < indices) this.idx = new Uint32Array(indices);
    return {
      pos: this.pos, nrm: this.nrm, col: this.col, along: this.along, kind: this.kindAttr,
      glow: this.glow, wave: this.wave, gab: this.gab, gba: this.gba, alpha: this.alpha,
      idx: this.idx, vi: 0, ii: 0,
    };
  }

  private rebuild(
    nodes: FabricNodePose[],
    edges: FabricEdgePose[],
    faces: [string, string, string][],
    byId: Map<string, FabricNodePose>,
  ): void {
    const cap = fabricCapacity(this.kind, nodes.length, edges.length, faces.length);
    const w = this.ensure(Math.max(cap.verts, 8), Math.max(cap.indices, 8));
    if (this.kind === "ribbon") {
      for (const n of nodes) writeNodeDisc(w, n);
      for (const e of edges) {
        const a = byId.get(e.a), b = byId.get(e.b);
        if (a && b) writeRibbon(w, a, b, e);
      }
    } else {
      for (const n of nodes) writeNodeHub(w, n);
      for (const e of edges) {
        const a = byId.get(e.a), b = byId.get(e.b);
        if (a && b) writeTube(w, a, b, e);
      }
      if (this.kind === "cloth") {
        for (const [ia, ib, ic] of faces) {
          const a = byId.get(ia), b = byId.get(ib), c = byId.get(ic);
          if (a && b && c) writeFace(w, a, b, c);
        }
      }
    }
    this.verts = w.vi;
    this.indices = w.ii;
    const geo = this.mesh.geometry;
    const bind = (name: string, data: Float32Array, itemSize: number) => {
      const cur = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!cur || cur.array !== data) geo.setAttribute(name, new THREE.BufferAttribute(data, itemSize));
      else cur.needsUpdate = true;
    };
    bind("position", this.pos, 3);
    bind("normal", this.nrm, 3);
    bind("color", this.col, 3);
    bind("aAlong", this.along, 1);
    bind("aKind", this.kindAttr, 1);
    bind("aGlow", this.glow, 1);
    bind("aWave", this.wave, 1);
    bind("aGab", this.gab, 1);
    bind("aGba", this.gba, 1);
    bind("aAlpha", this.alpha, 1);
    const index = geo.getIndex();
    if (!index || index.array !== this.idx) geo.setIndex(new THREE.BufferAttribute(this.idx, 1));
    else index.needsUpdate = true;
    geo.setDrawRange(0, this.indices);
    geo.computeBoundingSphere();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
