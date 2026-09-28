import * as THREE from "three";
import { mixFade } from "./morph";
import { organicEdgePoint } from "./physics";
import { graphLayoutIsFlat, graphLayoutPinned, type GraphLayout } from "./graph-layouts";

/** How the graph is drawn as a living surface. `auto` follows the plugin; `off` keeps spheres + lines. */
export const FABRIC_KINDS = [
  "auto", "off",
  "tubes", "cloth", "crystals", "voxels", "neon", "beads", "pillars", "orbit", "wire", "lattice",
  "ribbon", "dots", "constellation", "hex", "circuit", "ink", "map", "tiles", "mosaic",
  "octopus", "jelly", "hole", "tornado", "burst",
] as const;
export type FabricKind = (typeof FABRIC_KINDS)[number];

export const FABRIC_OPTIONS: { value: FabricKind; label: string; hint: string }[] = [
  { value: "auto", label: "auto", hint: "plugin style.fabric, or classic spheres if the view does not pin one" },
  { value: "off", label: "spheres", hint: "classic 3D spheres and line edges" },
  { value: "tubes", label: "tubes", hint: "3D tubular mesh for nodes and edges" },
  { value: "cloth", label: "cloth", hint: "3D tubes plus billowing triangle-cycle panels" },
  { value: "crystals", label: "crystals", hint: "3D octahedron nodes on thin rods" },
  { value: "voxels", label: "voxels", hint: "3D cubes linked by chunky tubes" },
  { value: "neon", label: "neon", hint: "3D thin glowing tubes" },
  { value: "beads", label: "beads", hint: "3D hubs with beads strung along edges" },
  { value: "pillars", label: "pillars", hint: "3D extruded bars at nodes" },
  { value: "orbit", label: "orbit", hint: "3D ring knots with thin links" },
  { value: "wire", label: "wire", hint: "3D low-poly wireframe" },
  { value: "lattice", label: "lattice", hint: "3D cubes, thin rods, and cycle faces" },
  { value: "ribbon", label: "ribbon", hint: "2D flat ribbons with disc knots" },
  { value: "dots", label: "dots", hint: "2D discs only — no edge mesh" },
  { value: "constellation", label: "stars", hint: "2D small discs on hairline ribbons" },
  { value: "hex", label: "hex", hint: "2D hex tiles with ribbons" },
  { value: "circuit", label: "circuit", hint: "2D pads with right-angle traces" },
  { value: "ink", label: "ink", hint: "2D fat brush-stroke ribbons" },
  { value: "map", label: "map", hint: "2D wide discs with thin roads" },
  { value: "tiles", label: "tiles", hint: "2D hexes with filled cycles, no rods" },
  { value: "mosaic", label: "mosaic", hint: "2D hexes, ribbons, and cycle panels" },
  { value: "octopus", label: "octopus", hint: "3D mantle with curling, tapering tentacles" },
  { value: "jelly", label: "jellyfish", hint: "3D bell with trailing wavy strands" },
  { value: "hole", label: "black hole", hint: "3D dark core, accretion disc, and a spiral stream" },
  { value: "tornado", label: "tornado", hint: "3D funnel mouth and a widening helix" },
  { value: "burst", label: "burst", hint: "3D spiked blast with shards along each link" },
];

/** Concrete styles dice / shuffle may pick (not `auto`). */
export const FABRIC_DICE: FabricKind[] = FABRIC_KINDS.filter((k) => k !== "auto");

export const GRAPH_SPACES = ["auto", "space", "plane"] as const;
export type GraphSpace = (typeof GRAPH_SPACES)[number];

export const GRAPH_SPACE_OPTIONS: { value: GraphSpace; label: string; hint: string }[] = [
  { value: "auto", label: "auto", hint: "plugin style.flatten — LAN rings stay flat, other views keep their default" },
  { value: "space", label: "3D", hint: "force a volumetric layout so any graph can fill space" },
  { value: "plane", label: "2D", hint: "force a flat layout so any graph sits on a plane" },
];

export function parseFabric(raw: unknown): FabricKind | undefined {
  if (raw === true) return "tubes";
  if (raw === false) return "off";
  if (typeof raw === "string" && (FABRIC_KINDS as readonly string[]).includes(raw)) {
    return raw as FabricKind;
  }
  return undefined;
}

export function parseGraphSpace(raw: unknown): GraphSpace | undefined {
  if (typeof raw === "string" && (GRAPH_SPACES as readonly string[]).includes(raw)) {
    return raw as GraphSpace;
  }
  return undefined;
}

export function fabricActive(kind: FabricKind | undefined): boolean {
  return !!kind && kind !== "off" && kind !== "auto";
}

/**
 * Settings / dice named style wins. `auto` (and unset) falls through to the
 * plugin `style.fabric`. `off` forces classic spheres.
 */
export function resolveFabric(
  mode?: FabricKind | false | null,
  anim?: FabricKind | boolean | null,
): FabricKind {
  const pinned = parseFabric(anim);
  if (pinned && pinned !== "auto") return pinned;
  const fallback = parseFabric(mode ?? undefined);
  if (fallback && fallback !== "auto" && fallback !== "off") return fallback;
  return "off";
}

/**
 * `auto` keeps the view's flatten flag; plane / space override any plugin.
 * A pinned host layout (tree / globe / bars / …) picks its own dimensionality
 * unless space is forced.
 */
export function resolveGraphFlatten(
  modeFlatten: boolean | undefined,
  space?: GraphSpace | null,
  layout?: GraphLayout | null,
): boolean {
  if (space === "plane") return true;
  if (space === "space") return false;
  if (graphLayoutPinned(layout) && layout && layout !== "force") return graphLayoutIsFlat(layout);
  if (layout === "force") return false;
  return modeFlatten !== false;
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
  /** Layout-space trail so the node sits behind the wires, along the cloud's travel. */
  lx?: number;
  ly?: number;
  lz?: number;
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
  /** Spring slack of the edge middle, in layout space. Bows the wire inward. */
  sx?: number;
  sy?: number;
  sz?: number;
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

type NodeDraw = "hub" | "disc" | "hex" | "cube" | "octa" | "ring" | "pillar" | "mantle" | "bell" | "hole" | "funnel" | "burst";
type EdgeDraw = "tube" | "thin" | "ribbon" | "fat" | "bead" | "elbow" | "none" | "tentacle" | "strands" | "spiral" | "helix" | "shards";

export type FabricProfile = { node: NodeDraw; edge: EdgeDraw; faces: boolean; glow?: number };

const HEX_SIDES = 6;
const RING_SEG = 8;
const BEAD_N = 4;
const OCTA_VERTS = 6;
const OCTA_TRIS = 8;
const CUBE_VERTS = 24;
const CUBE_TRIS = 12;
const PILLAR_VERTS = 24;
const PILLAR_TRIS = 12;
const CURL_ALONG = 8;
const CURL_RADIAL = 5;
const CONE_SEG = 5;
const OCTO_ARMS = 6;
const BELL_ROWS = 4;
const HOLE_LAT = 3;
const HOLE_LON = 6;
const HOLE_DISC = 14;
const FUNNEL_SEG = 8;
const BURST_SPIKES = 12;
const JELLY_STRANDS = 3;
const SHARD_N = 5;

const FABRIC_PROFILE: Record<string, FabricProfile> = {
  tubes: { node: "hub", edge: "tube", faces: false },
  cloth: { node: "hub", edge: "tube", faces: true },
  crystals: { node: "octa", edge: "thin", faces: false },
  voxels: { node: "cube", edge: "tube", faces: false },
  neon: { node: "hub", edge: "thin", faces: false, glow: 1.7 },
  beads: { node: "hub", edge: "bead", faces: false },
  pillars: { node: "pillar", edge: "thin", faces: false },
  orbit: { node: "ring", edge: "thin", faces: false },
  wire: { node: "octa", edge: "thin", faces: false },
  lattice: { node: "cube", edge: "thin", faces: true },
  ribbon: { node: "disc", edge: "ribbon", faces: false },
  dots: { node: "disc", edge: "none", faces: false },
  constellation: { node: "disc", edge: "ribbon", faces: false },
  hex: { node: "hex", edge: "ribbon", faces: false },
  circuit: { node: "cube", edge: "elbow", faces: false },
  ink: { node: "disc", edge: "fat", faces: false },
  map: { node: "disc", edge: "ribbon", faces: false },
  tiles: { node: "hex", edge: "none", faces: true },
  mosaic: { node: "hex", edge: "ribbon", faces: true },
  octopus: { node: "mantle", edge: "tentacle", faces: false },
  jelly: { node: "bell", edge: "strands", faces: false },
  hole: { node: "hole", edge: "spiral", faces: false },
  tornado: { node: "funnel", edge: "helix", faces: false },
  burst: { node: "burst", edge: "shards", faces: false },
};

export function fabricProfile(kind: FabricKind): FabricProfile | undefined {
  return FABRIC_PROFILE[kind];
}

function nodeCapacity(draw: NodeDraw): { verts: number; indices: number } {
  if (draw === "disc") return { verts: discVertCount(), indices: discIndexCount() };
  if (draw === "hex") return { verts: HEX_SIDES + 1, indices: HEX_SIDES * 3 };
  if (draw === "cube") return { verts: CUBE_VERTS, indices: CUBE_TRIS * 3 };
  if (draw === "octa") return { verts: OCTA_VERTS, indices: OCTA_TRIS * 3 };
  if (draw === "ring") return { verts: RING_SEG * 2, indices: RING_SEG * 6 };
  if (draw === "pillar") return { verts: PILLAR_VERTS, indices: PILLAR_TRIS * 3 };
  if (draw === "mantle") {
    return {
      verts: nodeVertCount() + OCTO_ARMS * (1 + CONE_SEG),
      indices: nodeIndexCount() + OCTO_ARMS * CONE_SEG * 3,
    };
  }
  if (draw === "bell") {
    return {
      verts: BELL_ROWS * (NODE_LON + 1) + NODE_LON * 2,
      indices: (BELL_ROWS - 1) * NODE_LON * 6 + NODE_LON * 6,
    };
  }
  if (draw === "hole") {
    return {
      verts: (HOLE_LAT + 1) * (HOLE_LON + 1) + HOLE_DISC * 2,
      indices: HOLE_LAT * HOLE_LON * 6 + HOLE_DISC * 6,
    };
  }
  if (draw === "funnel") return { verts: FUNNEL_SEG * 2, indices: FUNNEL_SEG * 6 };
  if (draw === "burst") return { verts: BURST_SPIKES * 4, indices: BURST_SPIKES * 9 };
  return { verts: nodeVertCount(), indices: nodeIndexCount() };
}

function edgeCapacity(draw: EdgeDraw): { verts: number; indices: number } {
  if (draw === "none") return { verts: 0, indices: 0 };
  if (draw === "ribbon" || draw === "fat") return { verts: ribbonVertCount(), indices: ribbonIndexCount() };
  if (draw === "elbow") return { verts: ribbonVertCount() * 2, indices: ribbonIndexCount() * 2 };
  if (draw === "bead") return { verts: OCTA_VERTS * BEAD_N, indices: OCTA_TRIS * 3 * BEAD_N };
  if (draw === "tentacle" || draw === "spiral" || draw === "helix") {
    return { verts: CURL_ALONG * CURL_RADIAL, indices: (CURL_ALONG - 1) * CURL_RADIAL * 6 };
  }
  if (draw === "strands") return { verts: ribbonVertCount() * JELLY_STRANDS, indices: ribbonIndexCount() * JELLY_STRANDS };
  if (draw === "shards") return { verts: SHARD_N * 4, indices: SHARD_N * 12 };
  return { verts: tubeVertCount(), indices: tubeIndexCount() };
}

export function fabricCapacity(kind: FabricKind, nNodes: number, nEdges: number, nFaces: number): { verts: number; indices: number } {
  const spec = fabricProfile(kind);
  if (!spec) return { verts: 0, indices: 0 };
  const nodes = Math.min(nNodes, MAX_NODES);
  const edges = Math.min(nEdges, MAX_EDGES);
  const faces = spec.faces ? Math.min(nFaces, MAX_FACES) : 0;
  const n = nodeCapacity(spec.node);
  const e = edgeCapacity(spec.edge);
  return {
    verts: nodes * n.verts + edges * e.verts + faces * faceVertCount(),
    indices: nodes * n.indices + edges * e.indices + faces * faceIndexCount(),
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
  wave = 0.0;
} else if (aKind < 1.5) {
  wave = aWave * 0.06 * sin(aAlong * 3.0);
} else {
  wave = 0.04 * sin(aAlong * 4.0);
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
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.48;\ndiffuseColor.a *= vAlpha;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * min(vGlow, 0.35) * 0.06;")
      .replace("#include <opaque_fragment>", "outgoingLight = min(outgoingLight, max(vColor.rgb, vec3(0.04)));\n#include <opaque_fragment>");
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

function writeNodeHex(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.48, n.scale);
  const c = writeVert(w, n.x, n.y, n.z, 0, 1, 0, n.r, n.g, n.b, 0.5, 0, n.glow, 0, 0, 0, n.opacity);
  for (let j = 0; j < HEX_SIDES; j++) {
    const u = j / HEX_SIDES;
    const th = u * Math.PI * 2 + Math.PI / 6;
    writeVert(w, n.x + Math.cos(th) * s, n.y, n.z + Math.sin(th) * s, 0, 1, 0, n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity);
  }
  for (let j = 0; j < HEX_SIDES; j++) writeTri(w, c, c + 1 + j, c + 1 + ((j + 1) % HEX_SIDES));
}

function writeNodeBox(w: Writer, n: FabricNodePose, sx: number, sy: number, sz: number): void {
  const hx = Math.max(0.22, sx), hy = Math.max(0.16, sy), hz = Math.max(0.22, sz);
  const faces: { n: [number, number, number]; q: [number, number, number][] }[] = [
    { n: [0, 0, 1], q: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], q: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], q: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], q: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], q: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], q: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ];
  for (const face of faces) {
    const base = w.vi;
    const [nx, ny, nz] = face.n;
    for (const [x, y, z] of face.q) {
      writeVert(w, n.x + x, n.y + y, n.z + z, nx, ny, nz, n.r, n.g, n.b, 0.5, 0, n.glow, 0, 0, 0, n.opacity);
    }
    writeTri(w, base, base + 1, base + 2);
    writeTri(w, base, base + 2, base + 3);
  }
}

function writeNodeCube(w: Writer, n: FabricNodePose, squat = false): void {
  const s = Math.max(0.32, n.scale * (squat ? 0.72 : 0.85));
  writeNodeBox(w, n, s, squat ? s * 0.28 : s, s);
}

function writeNodeOcta(w: Writer, n: FabricNodePose, scale = 1): void {
  const s = Math.max(0.28, n.scale * 0.95 * scale);
  const pts: [number, number, number][] = [
    [0, s, 0], [0, -s, 0], [s, 0, 0], [-s, 0, 0], [0, 0, s], [0, 0, -s],
  ];
  const tris: [number, number, number][] = [
    [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
    [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5],
  ];
  const base = w.vi;
  for (const [x, y, z] of pts) {
    const nx = x / s, ny = y / s, nz = z / s;
    writeVert(w, n.x + x, n.y + y, n.z + z, nx, ny, nz, n.r, n.g, n.b, 0.5, 0, n.glow, 0, 0, 0, n.opacity);
  }
  for (const [a, b, c] of tris) writeTri(w, base + a, base + b, base + c);
}

function writeNodeRing(w: Writer, n: FabricNodePose): void {
  const outer = Math.max(0.5, n.scale * 1.05);
  const inner = outer * 0.55;
  const base = w.vi;
  for (let j = 0; j < RING_SEG; j++) {
    const u = j / RING_SEG;
    const th = u * Math.PI * 2;
    const cx = Math.cos(th), sz = Math.sin(th);
    writeVert(w, n.x + cx * inner, n.y, n.z + sz * inner, 0, 1, 0, n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity);
    writeVert(w, n.x + cx * outer, n.y, n.z + sz * outer, 0, 1, 0, n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity);
  }
  for (let j = 0; j < RING_SEG; j++) {
    const i0 = base + j * 2, i1 = i0 + 1, i2 = base + ((j + 1) % RING_SEG) * 2, i3 = i2 + 1;
    writeTri(w, i0, i2, i1);
    writeTri(w, i1, i2, i3);
  }
}

function writeNodePillar(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.28, n.scale * 0.55);
  writeNodeBox(w, n, s, Math.max(0.7, n.scale * 1.35), s);
}

function writeTube(
  w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose, radMul = 1,
  pullX = 0, pullY = 0, pullZ = 0, bend = 1,
): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { n, b: bin } = frame(dx, dy, dz);
  const base = w.vi;
  for (let s = 0; s < TUBE_ALONG; s++) {
    const t = s / (TUBE_ALONG - 1);
    const at = organicEdgePoint(a.x, a.y, a.z, b.x, b.y, b.z, t, pullX, pullY, pullZ, 0, 0, 0, 0, 0, 0, bend);
    const cx = at[0], cy = at[1], cz = at[2];
    const rad = Math.max(0.12, (a.scale * (1 - t) + b.scale * t) * 0.42 * radMul);
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

function writeRibbon(
  w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose, widthMul = 1,
  pullX = 0, pullY = 0, pullZ = 0, bend = 1,
): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { b: bin } = frame(dx, dy, dz);
  const base = w.vi;
  for (let s = 0; s < RIBBON_ALONG; s++) {
    const t = s / (RIBBON_ALONG - 1);
    const at = organicEdgePoint(a.x, a.y, a.z, b.x, b.y, b.z, t, pullX, pullY, pullZ, 0, 0, 0, 0, 0, 0, bend);
    const cx = at[0], cy = at[1], cz = at[2];
    const half = Math.max(0.12, (a.scale * (1 - t) + b.scale * t) * 0.55 * widthMul);
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

function writeBeads(
  w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose,
  pullX = 0, pullY = 0, pullZ = 0, bend = 1,
): void {
  for (let i = 0; i < BEAD_N; i++) {
    const t = (i + 1) / (BEAD_N + 1);
    const at = organicEdgePoint(a.x, a.y, a.z, b.x, b.y, b.z, t, pullX, pullY, pullZ, 0, 0, 0, 0, 0, 0, bend);
    const bead: FabricNodePose = {
      id: `${a.id}:${b.id}:${i}`,
      x: at[0],
      y: at[1],
      z: at[2],
      scale: Math.max(0.22, (a.scale * (1 - t) + b.scale * t) * 0.38),
      r: a.r * (1 - t) + e.r0 * t,
      g: a.g * (1 - t) + e.g0 * t,
      b: a.b * (1 - t) + e.b0 * t,
      glow: a.glow * (1 - t) + b.glow * t,
      opacity: Math.min(a.opacity, b.opacity),
      visible: true,
    };
    writeNodeOcta(w, bead, 1);
  }
}

function anchor(n: FabricNodePose): FabricNodePose {
  const lx = n.lx ?? 0, ly = n.ly ?? 0, lz = n.lz ?? 0;
  if (!lx && !ly && !lz) return n;
  return { ...n, x: n.x + lx, y: n.y + ly, z: n.z + lz, lx: 0, ly: 0, lz: 0 };
}

function writeElbow(w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose): void {
  const mid: FabricNodePose = {
    ...a,
    id: `${a.id}|${b.id}`,
    x: b.x,
    y: (a.y + b.y) * 0.5,
    z: a.z,
    scale: (a.scale + b.scale) * 0.5,
    r: (a.r + b.r) * 0.5,
    g: (a.g + b.g) * 0.5,
    b: (a.b + b.b) * 0.5,
    glow: (a.glow + b.glow) * 0.5,
    opacity: Math.min(a.opacity, b.opacity),
  };
  writeRibbon(w, a, mid, e, 0.55);
  writeRibbon(w, mid, b, e, 0.55);
}

function writeEllipsoid(w: Writer, n: FabricNodePose, sx: number, sy: number, sz: number): void {
  const base = w.vi;
  for (let i = 0; i <= NODE_LAT; i++) {
    const v = i / NODE_LAT;
    const phi = v * Math.PI;
    const cy = Math.cos(phi);
    const xr = Math.sin(phi);
    for (let j = 0; j <= NODE_LON; j++) {
      const u = j / NODE_LON;
      const th = u * Math.PI * 2;
      const nx = xr * Math.cos(th);
      const nz = xr * Math.sin(th);
      writeVert(
        w, n.x + nx * sx, n.y + cy * sy, n.z + nz * sz, nx, cy, nz,
        n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity,
      );
    }
  }
  const stride = NODE_LON + 1;
  for (let i = 0; i < NODE_LAT; i++) {
    for (let j = 0; j < NODE_LON; j++) {
      const a = base + i * stride + j;
      const c = a + stride;
      writeTri(w, a, c, a + 1);
      writeTri(w, a + 1, c, c + 1);
    }
  }
}

function writeCone(
  w: Writer, n: FabricNodePose,
  ax: number, ay: number, az: number,
  dx: number, dy: number, dz: number,
  rad: number,
): void {
  const { n: side, b } = frame(dx, dy, dz);
  const apex = writeVert(w, ax, ay, az, dx, dy, dz, n.r, n.g, n.b, 0, 0, n.glow, 0, 0, 0, n.opacity);
  const base = w.vi;
  for (let j = 0; j < CONE_SEG; j++) {
    const ang = (j / CONE_SEG) * Math.PI * 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    const ox = side[0] * c + b[0] * s;
    const oy = side[1] * c + b[1] * s;
    const oz = side[2] * c + b[2] * s;
    writeVert(w, ax + dx + ox * rad, ay + dy + oy * rad, az + dz + oz * rad, ox, oy, oz, n.r, n.g, n.b, j / CONE_SEG, 1, n.glow, 0, 0, 0, n.opacity);
  }
  for (let j = 0; j < CONE_SEG; j++) writeTri(w, apex, base + j, base + ((j + 1) % CONE_SEG));
}

function writeMantle(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.45, n.scale);
  writeEllipsoid(w, n, s * 1.25, s * 0.62, s * 1.25);
  for (let j = 0; j < OCTO_ARMS; j++) {
    const ang = (j / OCTO_ARMS) * Math.PI * 2;
    const c = Math.cos(ang), sn = Math.sin(ang);
    writeCone(
      w, n,
      n.x + c * s * 0.4, n.y - s * 0.2, n.z + sn * s * 0.4,
      c * s * 0.55, -s * 0.85, sn * s * 0.55,
      s * 0.16,
    );
  }
}

function writeBell(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.45, n.scale);
  const base = w.vi;
  const stride = NODE_LON + 1;
  for (let i = 0; i < BELL_ROWS; i++) {
    const phi = (i / (BELL_ROWS - 1)) * (Math.PI * 0.62);
    const cy = Math.cos(phi);
    const xr = Math.sin(phi);
    for (let j = 0; j <= NODE_LON; j++) {
      const u = j / NODE_LON;
      const th = u * Math.PI * 2;
      const nx = xr * Math.cos(th);
      const nz = xr * Math.sin(th);
      writeVert(w, n.x + nx * s * 1.15, n.y + cy * s * 0.85, n.z + nz * s * 1.15, nx, cy, nz, n.r, n.g, n.b, u, 0, n.glow, 0, 0, 0, n.opacity);
    }
  }
  for (let i = 0; i < BELL_ROWS - 1; i++) {
    for (let j = 0; j < NODE_LON; j++) {
      const a = base + i * stride + j;
      const c = a + stride;
      writeTri(w, a, c, a + 1);
      writeTri(w, a + 1, c, c + 1);
    }
  }
  const rim = base + (BELL_ROWS - 1) * stride;
  const skirt = w.vi;
  for (let j = 0; j < NODE_LON; j++) {
    const th = (j / NODE_LON) * Math.PI * 2;
    const wave = 0.75 + 0.25 * Math.sin(th * 3);
    writeVert(
      w, n.x + Math.cos(th) * s * 0.7, n.y - s * 0.55 * wave, n.z + Math.sin(th) * s * 0.7,
      0, -1, 0, n.r, n.g, n.b, j / NODE_LON, 1, n.glow, 0, 0, 0, n.opacity,
    );
    writeVert(
      w, n.x + Math.cos(th) * s * 1.05, n.y - s * 0.15, n.z + Math.sin(th) * s * 1.05,
      0, -0.4, 0, n.r, n.g, n.b, j / NODE_LON, 1, n.glow, 0, 0, 0, n.opacity,
    );
  }
  for (let j = 0; j < NODE_LON; j++) {
    const j2 = (j + 1) % NODE_LON;
    writeTri(w, rim + j, skirt + j * 2, skirt + j2 * 2);
    writeTri(w, rim + j, skirt + j2 * 2, rim + j2);
  }
}

function writeHoleNode(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.4, n.scale);
  const core: FabricNodePose = { ...n, r: n.r * 0.12, g: n.g * 0.12, b: n.b * 0.14, glow: n.glow * 0.2 };
  const base = w.vi;
  for (let i = 0; i <= HOLE_LAT; i++) {
    const phi = (i / HOLE_LAT) * Math.PI;
    const cy = Math.cos(phi);
    const xr = Math.sin(phi);
    for (let j = 0; j <= HOLE_LON; j++) {
      const th = (j / HOLE_LON) * Math.PI * 2;
      const nx = xr * Math.cos(th);
      const nz = xr * Math.sin(th);
      writeVert(w, n.x + nx * s * 0.42, n.y + cy * s * 0.42, n.z + nz * s * 0.42, nx, cy, nz, core.r, core.g, core.b, j / HOLE_LON, 0, core.glow, 0, 0, 0, n.opacity);
    }
  }
  const stride = HOLE_LON + 1;
  for (let i = 0; i < HOLE_LAT; i++) {
    for (let j = 0; j < HOLE_LON; j++) {
      const a = base + i * stride + j;
      const c = a + stride;
      writeTri(w, a, c, a + 1);
      writeTri(w, a + 1, c, c + 1);
    }
  }
  const disc = w.vi;
  const inner = s * 0.7, outer = s * 1.85;
  for (let j = 0; j < HOLE_DISC; j++) {
    const th = (j / HOLE_DISC) * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    writeVert(w, n.x + c * inner, n.y, n.z + sn * inner, 0, 1, 0, n.r, n.g, n.b, j / HOLE_DISC, 1, n.glow + 0.4, 0, 0, 0, n.opacity);
    writeVert(w, n.x + c * outer, n.y, n.z + sn * outer, 0, 1, 0, n.r * 0.45, n.g * 0.35, n.b * 0.2, j / HOLE_DISC, 1, n.glow, 0, 0, 0, n.opacity);
  }
  for (let j = 0; j < HOLE_DISC; j++) {
    const j2 = (j + 1) % HOLE_DISC;
    writeTri(w, disc + j * 2, disc + j2 * 2, disc + j * 2 + 1);
    writeTri(w, disc + j * 2 + 1, disc + j2 * 2, disc + j2 * 2 + 1);
  }
}

function writeFunnelMouth(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.4, n.scale);
  const base = w.vi;
  for (let j = 0; j < FUNNEL_SEG; j++) {
    const th = (j / FUNNEL_SEG) * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    writeVert(w, n.x + c * s * 1.15, n.y + s * 0.15, n.z + sn * s * 1.15, c, 0.2, sn, n.r, n.g, n.b, j / FUNNEL_SEG, 0, n.glow, 0, 0, 0, n.opacity);
    writeVert(w, n.x + c * s * 0.28, n.y - s * 0.7, n.z + sn * s * 0.28, c, -0.3, sn, n.r, n.g, n.b, j / FUNNEL_SEG, 1, n.glow, 0, 0, 0, n.opacity);
  }
  for (let j = 0; j < FUNNEL_SEG; j++) {
    const j2 = (j + 1) % FUNNEL_SEG;
    writeTri(w, base + j * 2, base + j2 * 2, base + j * 2 + 1);
    writeTri(w, base + j * 2 + 1, base + j2 * 2, base + j2 * 2 + 1);
  }
}

const BURST_DIR: [number, number, number][] = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
  [1.4, 0.2, 0], [-1.4, 0.2, 0], [0.2, 1.4, 0], [0, 0.2, 1.4],
];

function writeBurstNode(w: Writer, n: FabricNodePose): void {
  const s = Math.max(0.35, n.scale);
  for (let i = 0; i < BURST_SPIKES; i++) {
    const d = BURST_DIR[i] ?? [0, 1, 0];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const dx = d[0] / len, dy = d[1] / len, dz = d[2] / len;
    const { n: side, b } = frame(dx, dy, dz);
    const reach = s * (i < 8 ? 1.85 : 1.45);
    const rad = s * 0.22;
    const tip = writeVert(w, n.x + dx * reach, n.y + dy * reach, n.z + dz * reach, dx, dy, dz, n.r, n.g, n.b, 1, 0, n.glow + 0.35, 0, 0, 0, n.opacity);
    const base = w.vi;
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const ox = side[0] * c + b[0] * sn;
      const oy = side[1] * c + b[1] * sn;
      const oz = side[2] * c + b[2] * sn;
      writeVert(
        w, n.x + dx * s * 0.25 + ox * rad, n.y + dy * s * 0.25 + oy * rad, n.z + dz * s * 0.25 + oz * rad,
        ox, oy, oz, n.r * 0.7, n.g * 0.55, n.b * 0.4, 0, 0, n.glow, 0, 0, 0, n.opacity,
      );
    }
    writeTri(w, tip, base, base + 1);
    writeTri(w, tip, base + 1, base + 2);
    writeTri(w, tip, base + 2, base);
  }
}

function writeCurl(
  w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose,
  pullX: number, pullY: number, pullZ: number,
  turns: number, rad0: number, rad1: number, tube0: number, tube1: number,
): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { n, b: bin } = frame(dx, dy, dz);
  const base = w.vi;
  for (let s = 0; s < CURL_ALONG; s++) {
    const t = s / (CURL_ALONG - 1);
    const at = organicEdgePoint(a.x, a.y, a.z, b.x, b.y, b.z, t, pullX, pullY, pullZ);
    const ang = t * turns * Math.PI * 2;
    const spr = rad0 + (rad1 - rad0) * t;
    const cx = at[0] + (n[0] * Math.cos(ang) + bin[0] * Math.sin(ang)) * spr;
    const cy = at[1] + (n[1] * Math.cos(ang) + bin[1] * Math.sin(ang)) * spr;
    const cz = at[2] + (n[2] * Math.cos(ang) + bin[2] * Math.sin(ang)) * spr;
    const tube = Math.max(0.08, tube0 + (tube1 - tube0) * t);
    const r = a.r + (e.r0 - a.r) * t;
    const g = a.g + (e.g0 - a.g) * t;
    const bl = a.b + (e.b0 - a.b) * t;
    for (let k = 0; k < CURL_RADIAL; k++) {
      const q = (k / CURL_RADIAL) * Math.PI * 2;
      const c = Math.cos(q), sn = Math.sin(q);
      const ox = n[0] * c + bin[0] * sn;
      const oy = n[1] * c + bin[1] * sn;
      const oz = n[2] * c + bin[2] * sn;
      writeVert(w, cx + ox * tube, cy + oy * tube, cz + oz * tube, ox, oy, oz, r, g, bl, t, 1, a.glow, e.wave, e.gab, e.gba, Math.min(a.opacity, b.opacity));
    }
  }
  for (let s = 0; s < CURL_ALONG - 1; s++) {
    for (let k = 0; k < CURL_RADIAL; k++) {
      const i0 = base + s * CURL_RADIAL + k;
      const i1 = base + s * CURL_RADIAL + (k + 1) % CURL_RADIAL;
      const i2 = i0 + CURL_RADIAL;
      const i3 = i1 + CURL_RADIAL;
      writeTri(w, i0, i2, i1);
      writeTri(w, i1, i2, i3);
    }
  }
}

function writeStrands(
  w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose,
  pullX: number, pullY: number, pullZ: number,
): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { n, b: bin } = frame(dx, dy, dz);
  const amp = Math.max(a.scale, b.scale) * 0.9;
  for (let strand = 0; strand < JELLY_STRANDS; strand++) {
    const phase = strand * (Math.PI * 2 / JELLY_STRANDS);
    const base = w.vi;
    for (let s = 0; s < RIBBON_ALONG; s++) {
      const t = s / (RIBBON_ALONG - 1);
      const at = organicEdgePoint(a.x, a.y, a.z, b.x, b.y, b.z, t, pullX, pullY, pullZ);
      const wave = Math.sin(t * Math.PI * 3 + phase) * amp * (0.35 + t);
      const cx = at[0] + n[0] * wave;
      const cy = at[1] + n[1] * wave - t * amp * 0.35;
      const cz = at[2] + n[2] * wave;
      const half = Math.max(0.06, (a.scale * (1 - t) + b.scale * t) * 0.16);
      const r = a.r * (1 - t) + e.r0 * t;
      const g = a.g * (1 - t) + e.g0 * t;
      const bl = a.b * (1 - t) + e.b0 * t;
      writeVert(w, cx + bin[0] * half, cy + bin[1] * half, cz + bin[2] * half, 0, 1, 0, r, g, bl, t, 1, a.glow, e.wave, e.gab, e.gba, Math.min(a.opacity, b.opacity));
      writeVert(w, cx - bin[0] * half, cy - bin[1] * half, cz - bin[2] * half, 0, 1, 0, r, g, bl, t, 1, a.glow, e.wave, e.gab, e.gba, Math.min(a.opacity, b.opacity));
    }
    for (let s = 0; s < RIBBON_ALONG - 1; s++) {
      const i0 = base + s * 2;
      writeTri(w, i0, i0 + 2, i0 + 1);
      writeTri(w, i0 + 1, i0 + 2, i0 + 3);
    }
  }
}

function writeShards(
  w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose,
  pullX: number, pullY: number, pullZ: number,
): void {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const { n, b: bin } = frame(dx, dy, dz);
  for (let i = 0; i < SHARD_N; i++) {
    const t = (i + 0.5) / SHARD_N;
    const at = organicEdgePoint(a.x, a.y, a.z, b.x, b.y, b.z, t, pullX, pullY, pullZ);
    const ang = i * 2.399 + t * 4;
    const kick = Math.max(a.scale, b.scale) * (0.55 + t);
    const cx = at[0] + (n[0] * Math.cos(ang) + bin[0] * Math.sin(ang)) * kick;
    const cy = at[1] + (n[1] * Math.cos(ang) + bin[1] * Math.sin(ang)) * kick;
    const cz = at[2] + (n[2] * Math.cos(ang) + bin[2] * Math.sin(ang)) * kick;
    const s = Math.max(0.2, (a.scale * (1 - t) + b.scale * t) * 0.45);
    const r = a.r * (1 - t) + e.r0 * t;
    const g = a.g * (1 - t) + e.g0 * t;
    const bl = a.b * (1 - t) + e.b0 * t;
    const base = w.vi;
    const pts: [number, number, number][] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    for (const p of pts) {
      const pl = Math.hypot(p[0], p[1], p[2]);
      writeVert(w, cx + p[0] / pl * s, cy + p[1] / pl * s, cz + p[2] / pl * s, p[0], p[1], p[2], r, g, bl, t, 1, a.glow + 0.2, e.wave, e.gab, e.gba, Math.min(a.opacity, b.opacity));
    }
    writeTri(w, base, base + 1, base + 2);
    writeTri(w, base, base + 2, base + 3);
    writeTri(w, base, base + 3, base + 1);
    writeTri(w, base + 1, base + 3, base + 2);
  }
}

function writeNodeKind(w: Writer, n: FabricNodePose, draw: NodeDraw, kind: FabricKind): void {
  if (n.lx || n.ly || n.lz) n = { ...n, x: n.x + (n.lx ?? 0), y: n.y + (n.ly ?? 0), z: n.z + (n.lz ?? 0) };
  const squat = kind === "circuit";
  if (draw === "disc") {
    const scale = kind === "map" ? n.scale * 1.35 : kind === "constellation" ? n.scale * 0.55 : n.scale;
    writeNodeDisc(w, scale === n.scale ? n : { ...n, scale });
    return;
  }
  if (draw === "hex") { writeNodeHex(w, n); return; }
  if (draw === "cube") { writeNodeCube(w, n, squat); return; }
  if (draw === "octa") { writeNodeOcta(w, n); return; }
  if (draw === "ring") { writeNodeRing(w, n); return; }
  if (draw === "pillar") { writeNodePillar(w, n); return; }
  if (draw === "mantle") { writeMantle(w, n); return; }
  if (draw === "bell") { writeBell(w, n); return; }
  if (draw === "hole") { writeHoleNode(w, n); return; }
  if (draw === "funnel") { writeFunnelMouth(w, n); return; }
  if (draw === "burst") { writeBurstNode(w, n); return; }
  writeNodeHub(w, n);
}

function writeEdgeKind(w: Writer, a: FabricNodePose, b: FabricNodePose, e: FabricEdgePose, draw: EdgeDraw, kind: FabricKind): void {
  if (draw === "none") return;
  const pullX = (b.lx ?? 0) - (a.lx ?? 0) + (e.sx ?? 0);
  const pullY = (b.ly ?? 0) - (a.ly ?? 0) + (e.sy ?? 0);
  const pullZ = (b.lz ?? 0) - (a.lz ?? 0) + (e.sz ?? 0);
  const da = anchor(a), db = anchor(b);
  if (draw === "bead") { writeBeads(w, da, db, e, pullX, pullY, pullZ); return; }
  if (draw === "elbow") { writeElbow(w, da, db, e); return; }
  if (draw === "ribbon") {
    writeRibbon(w, da, db, e, kind === "constellation" || kind === "map" ? 0.42 : 1, pullX, pullY, pullZ);
    return;
  }
  if (draw === "fat") { writeRibbon(w, da, db, e, 1.7, pullX, pullY, pullZ); return; }
  if (draw === "tentacle") {
    const spr = Math.max(da.scale, db.scale, 1.2);
    writeCurl(w, da, db, e, pullX, pullY, pullZ, 1.7, spr * 1.15, spr * 0.2, spr * 0.38, spr * 0.07);
    return;
  }
  if (draw === "strands") { writeStrands(w, da, db, e, pullX, pullY, pullZ); return; }
  if (draw === "spiral") {
    const spr = Math.max(da.scale, db.scale, 1);
    writeCurl(w, da, db, e, pullX, pullY, pullZ, 4.2, spr * 1.7, spr * 0.28, 0.28, 0.12);
    return;
  }
  if (draw === "helix") {
    const len = Math.hypot(db.x - da.x, db.y - da.y, db.z - da.z);
    writeCurl(
      w, da, db, e, pullX, pullY, pullZ, 3.1,
      Math.max(da.scale * 1.5, 2.4), Math.max(len * 0.09, db.scale),
      Math.max(0.2, da.scale * 0.2), Math.max(0.16, db.scale * 0.16),
    );
    return;
  }
  if (draw === "shards") { writeShards(w, da, db, e, pullX, pullY, pullZ); return; }
  writeTube(w, da, db, e, draw === "thin" ? 0.38 : 1, pullX, pullY, pullZ);
}

function baryIndex(i: number, j: number): number {
  let idx = 0;
  for (let r = 0; r < i; r++) idx += FACE_DIV - r + 1;
  return idx + j;
}

function writeFace(w: Writer, a: FabricNodePose, b: FabricNodePose, c: FabricNodePose): void {
  a = anchor(a); b = anchor(b); c = anchor(c);
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
    this.kindN = Math.max(0, FABRIC_DICE.indexOf(kind));
    this.sig = "";
    this.mesh.visible = fabricActive(kind);
  }

  /** CPU mesh the software canvas projects when this browser has no WebGL. */
  meshCpu(): { pos: Float32Array; col: Float32Array; idx: Uint32Array; verts: number; indices: number; scale: number } | null {
    if (!fabricActive(this.kind) || this.verts < 3 || this.indices < 3) return null;
    return {
      pos: this.pos, col: this.col, idx: this.idx,
      verts: this.verts, indices: this.indices, scale: this.mesh.scale.x,
    };
  }

  sync(nodes: FabricNodePose[], edges: FabricEdgePose[], faces: [string, string, string][], opts: FabricSyncOpts): void {
    if (!fabricActive(this.kind)) {
      this.mesh.visible = false;
      return;
    }
    const visNodes = nodes.filter((n) => n.visible).slice(0, MAX_NODES);
    const visEdges = edges.filter((e) => e.visible).slice(0, MAX_EDGES);
    const byId = new Map(visNodes.map((n) => [n.id, n]));
    const spec = fabricProfile(this.kind);
    const visFaces = spec?.faces
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
    // Lit tubes already carry the edge colour. Additive stacking at a hub clips to white.
    this.mat.blending = THREE.NormalBlending;
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
    const spec = fabricProfile(this.kind);
    if (!spec) return;
    const glow = spec.glow ?? 1;
    for (const n of nodes) writeNodeKind(w, glow === 1 ? n : { ...n, glow: n.glow * glow }, spec.node, this.kind);
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (a && b) writeEdgeKind(w, a, b, e, spec.edge, this.kind);
    }
    if (spec.faces) {
      for (const [ia, ib, ic] of faces) {
        const a = byId.get(ia), b = byId.get(ib), c = byId.get(ic);
        if (a && b && c) writeFace(w, a, b, c);
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
