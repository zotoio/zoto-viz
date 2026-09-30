import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BLOB_MESH_FLOOR,
  BLOB_MESH_SITES,
  BLOB_MESH_SLOT_BUDGET,
  BLOB_MESH_SLOT_TO_UV,
  BLOB_MESH_SPREAD,
  blobMeshPlacement,
  packBlobMeshSlots,
  planBlobMesh,
  type BlobMeshSiteMap,
} from "../../../plugins/sdk/blob-mesh-budget";
import { blobMeshLookNumber, blobMeshPackLook } from "./blob-mesh-look-test-helper";
import { appLensSkySpan, HOST_DEFAULT_PITCH_DEG, parentedSkyRay, type SkyRay, type SkySpan } from "./pack-sky-host-camera-test-helper";
import {
  appFivePatches,
  APP_QE_REGION,
  fivePatchSummary,
  hostLookUniforms,
  lanFrames35s,
  LAN_35S_PPS,
  UXPRO_DARK_LUM,
  UXPRO_MAX_DARK,
} from "./pack-sky-lan-frame-test-helper";
import type { PluginSkySmokeUniforms } from "./plugin-sky-smoke-render";
import { runPackFrameHandler, VIZ_PACK_TILE_ID_OPT } from "./viz-pack-host";
import { VIZ_UBO, type VizDataFrame } from "./viz-host";

/**
 * #174 dark-patch rows on a CPU mirror of plugins/src/blob-mesh/sky/fragment.glsl (no browser).
 *
 * Same inputs as the SwiftShader production row in blob-mesh-sky.test.ts ("lights the wall for a
 * 7-talker 420 pkt/s LAN at the host camera"): host-mirror slot 0, the camera
 * ray from parentedSkyRay at pitch 45 over appLensSkySpan, a 128 x 128 draw, and QE's app
 * five patches (appFivePatches: 3 x 3 px at the centre and quarter points of APP_QE_REGION;
 * a patch is dark below luma 24, pass needs <= 2 dark). The sky uniforms are what the plugin sky
 * draws with on main (#180 H1): the pack look from visualisation.yml (skyBright, skyOpacity, the
 * yml theme's bg) times the pack's own onFrame writes (packLook). "Dark patch" here is that five-patch rule,
 * not a connected-region count; connected dark regions are computed too, for information only.
 *
 * Approximations vs the GPU draw (SwiftShader):
 * - float64 JS instead of float32 GLSL; smoothstep / pow / clamp / step / mix follow the GLSL spec.
 * - vDir is taken as the exact linear interpolation of the quad's corner rays, (ndc.x, ndc.y, -1)
 *   up to scale, at pixel centres (the scale drops out in normalize). No MSAA (antialias: false).
 * - Output: no blending (the smoke draw leaves GL_BLEND off), rgb clamped to [0, 1] and rounded
 *   to bytes like readPixels(UNSIGNED_BYTE); luma = 0.2126 r + 0.7152 g + 0.0722 b.
 * - The floor and the empty-slot gate are read from the shader source (mirrorShape), so a change
 *   to either line changes the mirror; any other shader edit needs this mirror updated by hand.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SKY = readFileSync(path.resolve(here, "../../../plugins/src/blob-mesh/sky/fragment.glsl"), "utf8");
const SIZE = 128;

type Gate = "live-gated" | "always" | "only-written";
/** The blob falloff: the authored r^2/d^2 (reaches the whole field) or #193's compact kernel (0 past rad + gap / 2). */
type Falloff = { kind: "inverse-square" } | { kind: "compact"; gap: number };
type Shape = { floor: number; gate: Gate; falloff: Falloff; skyFloor: number };

const INVERSE_SQUARE_LINE = "float contrib = rad * rad / max(0.0012, dot(d, d));";
const COMPACT_LINES = [
  "float reach = rad + 0.5 * BLOB_GAP;",
  "float edge = rad * rad / (reach * reach);",
  "float contrib = max(0.0, (rad * rad / max(0.0012, dot(d, d)) - edge) / (1.0 - edge));",
];
const BLACK_SKY_LINE = "vec3 col = mix(uBg * 0.12, tint, iso);";
const FLOOR_SKY_LINE = "vec3 col = mix(mix(uBg * 0.12, uAccent, SKY_FLOOR), tint, iso);";

/** A `const float NAME = <number>;` from the shader source, or null when the shader has none. */
export function shaderConst(src: string, name: string): number | null {
  const m = src.match(new RegExp(`^const float ${name} = ([0-9.]+);$`, "m"));
  return m ? Number(m[1]) : null;
}

/** Read the lines these rows are about from the shader; refuse to guess on anything else. */
export function mirrorShape(src: string): Shape {
  const floorM = src.match(/float rad = max\(([0-9.]+), b\.z\)( \* drawn)?;/);
  if (!floorM) throw new Error("blob-mesh sky: `float rad = max(<floor>, b.z)` not found; update the CPU mirror");
  const floor = Number(floorM[1]);
  let falloff: Falloff;
  const gap = shaderConst(src, "BLOB_GAP");
  if (src.includes(INVERSE_SQUARE_LINE)) falloff = { kind: "inverse-square" };
  else if (COMPACT_LINES.every((l) => src.includes(l)) && gap !== null) falloff = { kind: "compact", gap };
  else throw new Error("blob-mesh sky: unrecognised blob falloff; update the CPU mirror");
  let skyFloor: number;
  const sf = shaderConst(src, "SKY_FLOOR");
  if (src.includes(BLACK_SKY_LINE)) skyFloor = 0;
  else if (src.includes(FLOOR_SKY_LINE) && sf !== null) skyFloor = sf;
  else throw new Error("blob-mesh sky: unrecognised empty-sky colour; update the CPU mirror");
  let gate: Gate;
  if (!floorM[2]) gate = "always";
  else if (/float drawn = max\(step\(0\.001, b\.z\), 1\.0 - live\);/.test(src)) gate = "live-gated";
  else if (/float drawn = step\(0\.001, b\.z\);/.test(src)) gate = "only-written";
  else throw new Error("blob-mesh sky: unrecognised `drawn` gate; update the CPU mirror");
  return { floor, gate, falloff, skyFloor };
}

/** The authored falloff and black empty sky (what #174's SwiftShader floor scan rendered), from any current source. */
export function authoredFalloff(src: string): string {
  let out = src.replace(COMPACT_LINES.join("\n    "), INVERSE_SQUARE_LINE).replace(FLOOR_SKY_LINE, BLACK_SKY_LINE);
  if (!out.includes(INVERSE_SQUARE_LINE) || !out.includes(BLACK_SKY_LINE)) throw new Error("blob-mesh sky: can't fold back to the authored falloff");
  out = out.replace(/^const float (BLOB_GAP|SKY_FLOOR) = [0-9.]+;\n/gm, "");
  return out;
}

/** One blob's field contribution at squared distance d2 (fragment.glsl's contrib line). */
function blobContrib(rad: number, d2: number, falloff: Falloff): number {
  const inv = (rad * rad) / Math.max(0.0012, d2);
  if (falloff.kind === "inverse-square") return inv;
  const reach = rad + 0.5 * falloff.gap;
  const edge = (rad * rad) / (reach * reach);
  return Math.max(0, (inv - edge) / (1 - edge));
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const step = (edge: number, x: number) => (x < edge ? 0 : 1);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const mix3 = (a: number[], b: number[], t: number) => [mix(a[0]!, b[0]!, t), mix(a[1]!, b[1]!, t), mix(a[2]!, b[2]!, t)];
const norm3 = (v: number[]) => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

/** One pixel of fragment.glsl main(), given the host-camera ray (atHostCamera's rewrite of normalize(vDir)). */
function shadePixel(cam: number[], slots: Float32Array, u: PluginSkySmokeUniforms, shape: Shape): number[] {
  const dir = norm3([cam[0]!, 0.70710678 * (cam[1]! + cam[2]!), 0.70710678 * (cam[2]! - cam[1]!)]);
  const k = 0.35 + Math.abs(dir[1]!);
  const uvx = dir[0]! / k;
  const uvy = dir[2]! / k;
  let field = 0;
  let tint = [...u.uAccent];
  let live = 0;
  for (let i = 0; i < 8; i++) live = Math.max(live, step(0.001, slots[i * 4 + 2]!));
  for (let i = 0; i < 8; i++) {
    const bx = slots[i * 4]!, by = slots[i * 4 + 1]!, bz = slots[i * 4 + 2]!, bw = slots[i * 4 + 3]!;
    const fi = i;
    const idle = [Math.sin(u.uTime * 0.35 + fi * 1.1) * 0.55, Math.cos(u.uTime * 0.28 + fi * 0.7) * 0.55];
    const on = step(0.02, Math.hypot(bx, by));
    const px = mix(idle[0]!, bx * 1.7, on);
    const py = mix(idle[1]!, by * 1.7, on);
    const drawn = shape.gate === "always" ? 1 : shape.gate === "live-gated" ? Math.max(step(0.001, bz), 1 - live) : step(0.001, bz);
    const rad = Math.max(shape.floor, bz) * drawn;
    const dx = uvx - px, dy = uvy - py;
    const contrib = blobContrib(rad, dx * dx + dy * dy, shape.falloff);
    field += contrib;
    tint = mix3(tint, mix3(u.uAccent, [0.15, 1.0, 0.72], Math.max(bw, fi / 8)), clamp(contrib * 0.12, 0, 0.4));
  }
  const iso = smoothstep(0.55, 1.25, field + 0.45 + u.uAudio * 0.3);
  const bg = mix3(u.uBg.map((c) => c * 0.12), u.uAccent, shape.skyFloor);
  let col = mix3(bg, tint, iso);
  const glow = Math.pow(clamp(field * 0.18, 0, 1), 2.4) * 0.7;
  col = col.map((c, j) => c + tint[j]! * glow);
  const hz = Math.pow(Math.max(0, 0.2 - Math.abs(dir[1]!)), 2) * 0.5;
  col = [col[0]! + 0.2 * hz, col[1]! + 0.9 * hz, col[2]! + 1.0 * hz];
  return col.map((c) => c * u.uBright);
}

/** 128 x 128 luma (0-255) in readPixels order (bottom row first), like smokeRenderPluginSky's keepLuma. */
function cpuLuma(slots: Float32Array, u: PluginSkySmokeUniforms, ray: SkyRay, span: SkySpan, shape: Shape): number[] {
  const m = ray; // column-major mat3
  const out: number[] = [];
  for (let gy = 0; gy < SIZE; gy++) {
    for (let gx = 0; gx < SIZE; gx++) {
      const v = [((gx + 0.5) / SIZE * 2 - 1) * span[0], ((gy + 0.5) / SIZE * 2 - 1) * span[1], -1];
      const cam = norm3([
        m[0]! * v[0]! + m[3]! * v[1]! + m[6]! * v[2]!,
        m[1]! * v[0]! + m[4]! * v[1]! + m[7]! * v[2]!,
        m[2]! * v[0]! + m[5]! * v[1]! + m[8]! * v[2]!,
      ]);
      const c = shadePixel(cam, slots, u, shape).map((x) => Math.round(clamp(x, 0, 1) * 255));
      out.push(0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!);
    }
  }
  return out;
}

/** Information only: 4-connected regions below the dark luma inside QE's app region. */
function connectedDarkRegions(luma: readonly number[]): number {
  const r = APP_QE_REGION;
  const x0 = Math.floor((r.x / r.viewW) * SIZE), x1 = Math.floor(((r.x + r.w) / r.viewW) * SIZE);
  const y0 = Math.floor((r.y / r.viewH) * SIZE), y1 = Math.floor(((r.y + r.h) / r.viewH) * SIZE);
  const dark = (x: number, y: number) => luma[(SIZE - 1 - y) * SIZE + x]! < UXPRO_DARK_LUM;
  const seen = new Set<number>();
  let regions = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!dark(x, y) || seen.has(y * SIZE + x)) continue;
      regions++;
      const stack = [[x, y]];
      seen.add(y * SIZE + x);
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        for (const [nx, ny] of [[cx! + 1, cy!], [cx! - 1, cy!], [cx!, cy! + 1], [cx!, cy! - 1]]) {
          if (nx! < x0 || nx! >= x1 || ny! < y0 || ny! >= y1 || seen.has(ny! * SIZE + nx!) || !dark(nx!, ny!)) continue;
          seen.add(ny! * SIZE + nx!);
          stack.push([nx!, ny!]);
        }
      }
    }
  }
  return regions;
}

const lookNumber = blobMeshLookNumber;
const packLook = blobMeshPackLook;
/** The look #174's SwiftShader floor scan rendered (calibration rows only). */
const SCAN_LOOK = hostLookUniforms({ skyBright: 1.18, skyOpacity: 0.96, rim: 0x4cc9f0, bg: 0x0b141c });
const RAY = parentedSkyRay("blob-mesh", SKY, HOST_DEFAULT_PITCH_DEG);
const SPAN = appLensSkySpan();

let hostTiles = 0;
/**
 * The slots the app draws for `frame` (host runPackFrameHandler). Each call is its own tile (fresh
 * #193 site map, just like the app on the first frame of a set), unless a row passes `tile` to carry a
 * site map across a frame sequence.
 */
function hostSlots(frame: VizDataFrame, tile = `dark-patches-${hostTiles++}`): Float32Array {
  const slots = new Float32Array(VIZ_UBO.totalFloats);
  runPackFrameHandler("blob-mesh", frame, {
    writeBuffer: (slot, data) => {
      slots.fill(0, slot * VIZ_UBO.slotFloats, (slot + 1) * VIZ_UBO.slotFloats);
      slots.set(data, slot * VIZ_UBO.slotFloats);
    },
    writeUniform: () => {},
    writeParticles: () => {},
  }, { [VIZ_PACK_TILE_ID_OPT]: tile });
  return slots;
}

/**
 * The pre-hash writer's placement (first character + slot index, orbiting the plane's origin), which
 * is what #174's SwiftShader floor scan rendered; the calibration rows need the same slots.
 */
function preHashSlots(frame: VizDataFrame): Float32Array {
  const slots = new Float32Array(VIZ_UBO.totalFloats);
  const hue = (role: string) => (role === "gateway" ? 0.08 : role === "internet" ? 0.78 : role === "lan" ? 0.45 : 0.22);
  frame.talkers.slice(0, 8).forEach((d, i) => {
    const h = (d.id.charCodeAt(0) + i * 19) % 97;
    const ang = (h / 97) * 6.283 + frame.t * (0.15 + i * 0.03);
    const r = 0.25 + (h % 20) / 50;
    slots.set([Math.cos(ang) * r, Math.sin(ang) * r, 0, hue(d.role)], i * 4);
  });
  return slots;
}

export function darkPatchReport(frame: VizDataFrame, src = SKY, radiusOverride?: number, placement: "writer" | "pre-hash" = "writer", look = packLook(frame).u) {
  const shape = mirrorShape(src);
  const slots = placement === "pre-hash" ? preHashSlots(frame) : hostSlots(frame);
  if (placement === "pre-hash" && radiusOverride === undefined) throw new Error("pre-hash slots need a radius");
  if (radiusOverride !== undefined) {
    for (let i = 0; i < Math.min(8, frame.talkers.length); i++) if (placement === "pre-hash" || slots[i * 4 + 2]! > 0) slots[i * 4 + 2] = radiusOverride;
  }
  const luma = cpuLuma(slots, look, RAY, SPAN, shape);
  const five = fivePatchSummary(appFivePatches(luma));
  const radii: number[] = [];
  for (let i = 0; i < 8; i++) if (slots[i * 4 + 2]! > 0) radii.push(slots[i * 4 + 2]!);
  const sumR2 = radii.reduce((s, r) => s + r * r, 0);
  // What the sky draws: every written slot at max(shader floor, r); no data at all -> 8 idle at the floor.
  const onScreen = radii.length > 0 ? radii.map((r) => Math.max(shape.floor, r)) : Array<number>(8).fill(shape.floor);
  const onScreenSumR2 = onScreen.reduce((s, r) => s + r * r, 0);
  const spread = Math.max(...five.lums) - Math.min(...five.lums);
  const regions = connectedDarkRegions(luma);
  const text = `${five.text} spread=${spread} max=${Math.max(...five.lums)} connectedDarkRegions=${regions} `
    + `radii=${radii.map((r) => r.toFixed(3)).join(",")} sumR2=${sumR2.toFixed(4)} floor=${shape.floor} gate=${shape.gate}`;
  return { five, spread, regions, sumR2, onScreen, onScreenSumR2, text };
}

/** Camera-local ray whose sky uv is (u, v) (inverse of the shader's plane map, the visible branch dir.y < 0). */
function rayAtUv(u: number, v: number): number[] {
  const q = u * u + v * v;
  const dy = (2 * q * 0.35 - Math.sqrt(4 * q * q * 0.35 * 0.35 - 4 * (q + 1) * (q * 0.35 * 0.35 - 1))) / (2 * (q + 1));
  const dx = u * (0.35 - dy);
  const dz = v * (0.35 - dy);
  return [dx, 0.70710678 * (dy - dz), 0.70710678 * (dy + dz)];
}
const lumaOf = (c: number[]) => {
  const b = c.map((x) => Math.round(clamp(x, 0, 1) * 255));
  return 0.2126 * b[0]! + 0.7152 * b[1]! + 0.0722 * b[2]!;
};

/**
 * #174 item b (UX Pro): size alone shows rate, and every blob must stand out from the sky. Both
 * numbers come from the CPU mirror of fragment.glsl with the pack look:
 * - dimmest blob: the lowest luma at any drawn blob's centre (the quietest blob sits at the floor);
 * - sky peak: the highest luma of any pixel in QE's app region that lies outside every drawn blob's
 *   radius (max(shader floor, r)), i.e. the lit field between and around the blobs.
 */
/**
 * blobVsSky's colours before shadePixel's last step (x uBright): the dimmest-blob probe at each drawn
 * blob's centre and every sky pixel of the QE region outside the blobs. uBright only scales the
 * finished colour, so skyGapAt(skyShades(f, look), ub) is exactly blobVsSky(f, { ...look, uBright: ub })
 * (x 1 is exact, then the same multiply), and one shading pass serves every uBright.
 */
export type SkyShades = { blobCols: number[][]; skyCols: number[][] };
export function skyShades(frame: VizDataFrame, look = packLook(frame).u, src = SKY): SkyShades {
  const unit = { ...look, uBright: 1 }; // shadePixel multiplies by uBright last, so x 1 leaves the colour as is
  const shape = mirrorShape(src);
  const slots = hostSlots(frame);
  const blobs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 8; i++) if (slots[i * 4 + 2]! > 0) blobs.push({ x: slots[i * 4]! * 1.7, y: slots[i * 4 + 1]! * 1.7, r: Math.max(shape.floor, slots[i * 4 + 2]!) });
  const blobCols = blobs.map((b) => shadePixel(rayAtUv(b.x, b.y), slots, unit, shape));
  const r = APP_QE_REGION;
  const x0 = Math.floor((r.x / r.viewW) * SIZE), x1 = Math.floor(((r.x + r.w) / r.viewW) * SIZE);
  const y0 = Math.floor((r.y / r.viewH) * SIZE), y1 = Math.floor(((r.y + r.h) / r.viewH) * SIZE);
  const m = RAY;
  const skyCols: number[][] = [];
  for (let py = y0; py < y1; py++) {
    const gy = SIZE - 1 - py; // readPixels order: bottom row first
    for (let gx = x0; gx < x1; gx++) {
      const v = [((gx + 0.5) / SIZE * 2 - 1) * SPAN[0], ((gy + 0.5) / SIZE * 2 - 1) * SPAN[1], -1];
      const cam = norm3([
        m[0]! * v[0]! + m[3]! * v[1]! + m[6]! * v[2]!,
        m[1]! * v[0]! + m[4]! * v[1]! + m[7]! * v[2]!,
        m[2]! * v[0]! + m[5]! * v[1]! + m[8]! * v[2]!,
      ]);
      const dir = norm3([cam[0]!, 0.70710678 * (cam[1]! + cam[2]!), 0.70710678 * (cam[2]! - cam[1]!)]);
      const k = 0.35 + Math.abs(dir[1]!);
      const u = dir[0]! / k, w = dir[2]! / k;
      if (blobs.some((b) => Math.hypot(u - b.x, w - b.y) <= b.r)) continue;
      skyCols.push(shadePixel(cam, slots, unit, shape));
    }
  }
  return { blobCols, skyCols };
}

/** blobVsSky's two lumas at uBright ub, from cached shades: the same last multiply, clamp and round. */
export function skyGapAt(sh: SkyShades, ub: number): { skyPeak: number; dimmestBlob: number } {
  const scaled = (c: number[]) => lumaOf(c.map((x) => x * ub));
  let skyPeak = 0;
  for (const c of sh.skyCols) skyPeak = Math.max(skyPeak, scaled(c));
  return { skyPeak, dimmestBlob: Math.min(...sh.blobCols.map(scaled)) };
}

/** The sky's brightest pixel in the QE region (outside the blobs) and the dimmest drawn blob's centre, in luma. */
export function blobVsSky(frame: VizDataFrame, look = packLook(frame).u, src = SKY): { skyPeak: number; dimmestBlob: number } {
  return skyGapAt(skyShades(frame, look, src), look.uBright);
}

/** Uncached reference for the cache check: blobVsSky's lumas with shadePixel at the full uBright. */
function blobVsSkyDirect(frame: VizDataFrame, look: PluginSkySmokeUniforms, src = SKY): { skyPeak: number; dimmestBlob: number } {
  const shape = mirrorShape(src);
  const slots = hostSlots(frame);
  const blobs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 8; i++) if (slots[i * 4 + 2]! > 0) blobs.push({ x: slots[i * 4]! * 1.7, y: slots[i * 4 + 1]! * 1.7, r: Math.max(shape.floor, slots[i * 4 + 2]!) });
  const dimmestBlob = Math.min(...blobs.map((b) => lumaOf(shadePixel(rayAtUv(b.x, b.y), slots, look, shape))));
  const r = APP_QE_REGION;
  const x0 = Math.floor((r.x / r.viewW) * SIZE), x1 = Math.floor(((r.x + r.w) / r.viewW) * SIZE);
  const y0 = Math.floor((r.y / r.viewH) * SIZE), y1 = Math.floor(((r.y + r.h) / r.viewH) * SIZE);
  const m = RAY;
  let skyPeak = 0;
  for (let py = y0; py < y1; py++) {
    const gy = SIZE - 1 - py; // readPixels order: bottom row first
    for (let gx = x0; gx < x1; gx++) {
      const v = [((gx + 0.5) / SIZE * 2 - 1) * SPAN[0], ((gy + 0.5) / SIZE * 2 - 1) * SPAN[1], -1];
      const cam = norm3([
        m[0]! * v[0]! + m[3]! * v[1]! + m[6]! * v[2]!,
        m[1]! * v[0]! + m[4]! * v[1]! + m[7]! * v[2]!,
        m[2]! * v[0]! + m[5]! * v[1]! + m[8]! * v[2]!,
      ]);
      const dir = norm3([cam[0]!, 0.70710678 * (cam[1]! + cam[2]!), 0.70710678 * (cam[2]! - cam[1]!)]);
      const k = 0.35 + Math.abs(dir[1]!);
      const u = dir[0]! / k, w = dir[2]! / k;
      if (blobs.some((b) => Math.hypot(u - b.x, w - b.y) <= b.r)) continue;
      skyPeak = Math.max(skyPeak, lumaOf(shadePixel(cam, slots, look, shape)));
    }
  }
  return { skyPeak, dimmestBlob };
}

/** Drawn blobs of a frame in uv (slot xy x 1.7), radius max(shader floor, slot r), the way blobVsSky reads them. */
function drawnBlobs(frame: VizDataFrame, shape: Shape): { x: number; y: number; r: number }[] {
  const slots = hostSlots(frame);
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 8; i++) if (slots[i * 4 + 2]! > 0) out.push({ x: slots[i * 4]! * 1.7, y: slots[i * 4 + 1]! * 1.7, r: Math.max(shape.floor, slots[i * 4 + 2]!) });
  return out;
}

/**
 * #193 merge distance of two blobs, from the falloff the mirror reads out of fragment.glsl: with the
 * compact falloff r1 + r2 + BLOB_GAP (the shader's constant, never retyped here); the authored
 * r^2/d^2 reaches the whole field, so it never lets two blobs apart (Infinity).
 */
export function mergeDistance(r1: number, r2: number, falloff: Falloff): number {
  return falloff.kind === "compact" ? r1 + r2 + falloff.gap : Infinity;
}

/** How many blobs stand apart: centre distance to every other blob >= their merge distance. */
export function separatedBlobs(blobs: readonly { x: number; y: number; r: number }[], falloff: Falloff): number {
  return blobs.filter((a, i) => blobs.every((b, j) => j === i || Math.hypot(a.x - b.x, a.y - b.y) >= mergeDistance(a.r, b.r, falloff))).length;
}

/** Inside the safe spread ellipse (BLOB_MESH_SPREAD, uv): the field every drawn centre may use. */
function inSafeEllipse(x: number, y: number): boolean {
  const { cx, cy, ax, ay } = BLOB_MESH_SPREAD;
  return ((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 <= 1 + 1e-12;
}

/** Lumps: blobs joined (union-find) when their centres are closer than their merge distance. */
export function blobLumps(blobs: readonly { x: number; y: number; r: number }[], falloff: Falloff): number {
  const parent = blobs.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
    const a = blobs[i]!, b = blobs[j]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < mergeDistance(a.r, b.r, falloff)) parent[root(i)] = root(j);
  }
  return new Set(blobs.map((_, i) => root(i))).size;
}

type PlacedBlob = { id: string; x: number; y: number; r: number; site: number | undefined };

/**
 * #193 real placement for one step of a sequence: packBlobMeshSlots settles `sites` (the site map
 * the sequence carries) and places every drawn device with blobMeshPlacement(id, t, sites). Throws
 * unless each slot is exactly blobMeshPlacement's answer and the slots the app draws (host
 * runPackFrameHandler on tile `tile`, fed the same sequence) match, so the rows measure the wall.
 */
function placedStep(frame: VizDataFrame, t: number, shape: Shape, sites: BlobMeshSiteMap, tile: string): PlacedBlob[] {
  const f = { ...frame, t };
  const pack = packBlobMeshSlots(f.talkers, t, sites);
  const drawn = hostSlots(f, tile);
  return pack.plan.shownIdx.map((ti, j) => {
    const id = f.talkers[ti]!.id;
    const [sx, sy] = blobMeshPlacement(id, t, sites);
    if (pack.slot0[j * 4] !== sx || pack.slot0[j * 4 + 1] !== sy) throw new Error(`placement: slot ${j} is not blobMeshPlacement(${id}, ${t})`);
    if (Math.abs(drawn[j * 4]! - sx) > 1e-6 || Math.abs(drawn[j * 4 + 1]! - sy) > 1e-6) {
      throw new Error(`placement: drawn slot ${j} (${drawn[j * 4]}, ${drawn[j * 4 + 1]}) is not blobMeshPlacement(${id}, ${t}) = (${sx}, ${sy})`);
    }
    return { id, x: sx * BLOB_MESH_SLOT_TO_UV, y: sy * BLOB_MESH_SLOT_TO_UV, r: Math.max(shape.floor, pack.plan.radii[j]!), site: sites.get(id) };
  });
}

const EMPTY: VizDataFrame = { t: 35, dt: 1 / 6, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
const talker = (ip: string, rate: number, role = "lan") => ({ id: ip, rate, role });
const LAN7 = lanFrames35s({ fixture: "host" }, 2)[0]!;
const EQUAL7: VizDataFrame = { ...EMPTY, talkers: ["104.18.32.7", "142.250.66.14", "172.30.0.1", "172.30.0.10", "172.30.0.21", "172.30.0.22", "172.30.0.23"].map((ip) => talker(ip, 60)) };
const BUSY1_IDLE6: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 400), ...[1, 2, 3, 4, 5, 6].map((i) => talker(`172.30.0.${30 + i}`, 1))] };
const SINGLE: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 300)] };
const FULL8: VizDataFrame = { ...EMPTY, talkers: Array.from({ length: 8 }, (_, i) => talker(`172.30.0.${10 + i}`, 120 - i * 12, i === 1 ? "gateway" : "lan")) };

const LAN11 = lanFrames35s({ fixture: "host" }, 2, 1, 6, 11)[0]!;
/** The quiet LAN from blob-mesh-sky.test.ts ("lights the wall on a quiet LAN"): 5 devices at 0.5 pkt/s. */
const QUIET5: VizDataFrame = { ...EMPTY, talkers: ["gateway", "lan", "internet", "lan", "local"].map((role, i) => talker(`192.168.1.${10 + i}`, 0.5, role)) };
/** A 1 pkt/s device next to a 400 pkt/s one. */
const LOW_BESIDE_BUSY: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 400), talker("172.30.0.31", 1)] };
const EQUAL8: VizDataFrame = { ...EMPTY, talkers: Array.from({ length: 8 }, (_, i) => talker(`172.30.0.${10 + i}`, 60)) };
const HALF: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 120), talker("172.30.0.11", 60), talker("172.30.0.12", 2)] };

/** #174 "Done when": live LAN patch spread >= 30 and every patch below 240. */
const MIN_SPREAD = 30;
const MAX_LUMA = 240;
/**
 * Every swept case. SINGLE (a lone device) and QUIET5 (5 devices at 0.5 pkt/s) were it.fails known
 * gaps under the authored r^2/d^2 falloff and black empty sky (spread min 26 at t=20 s and 22 at
 * t=10 s); the compact falloff (BLOB_GAP) and the accent sky floor (SKY_FLOOR) bring them over 30.
 */
const CONTRAST_CASES = ["LAN7", "LAN11", "SINGLE", "PAIR", "TRIPLE", "EQUAL7", "EQUAL8", "BUSY1_IDLE6", "QUIET5", "LOW_BESIDE_BUSY", "HALF", "FULL8"] as const;
/** #174 b (UX Pro): the sky's brightest pixel sits at least this far (luma) under the dimmest blob. */
const SKY_UNDER_BLOB_MARGIN = 5;
/** The audio peak (frame.audio is 0..1): the pack's uBright and the shader's iso both rise with it. */
const AUDIO_PEAK = 1;

export const DARK_PATCH_CASES = { LAN7, LAN11, EQUAL7, EQUAL8, BUSY1_IDLE6, SINGLE, QUIET5, LOW_BESIDE_BUSY, HALF, FULL8, EMPTY } as const;

describe(`blob-mesh dark patches on a CPU mirror of the sky (budget ${BLOB_MESH_SLOT_BUDGET.toFixed(4)}, floor ${BLOB_MESH_FLOOR})`, () => {
  it("mirror inputs: the live LAN frame is 7 devices at 420 pkt/s and the shader floor is the writers' floor", () => {
    expect(LAN7.talkers).toHaveLength(7);
    expect(LAN7.talkers.reduce((s, t) => s + t.rate, 0)).toBe(LAN_35S_PPS);
    expect(mirrorShape(SKY)).toMatchObject({ floor: BLOB_MESH_FLOOR, gate: "live-gated" });
    // FULL8 (120 down to 36 pkt/s) draws 7 (count first); the quietest is dropped and the notice says so
    expect(planBlobMesh(FULL8.talkers.map((t) => t.rate)).hidden).toBe(1);
    expect(planBlobMesh(EQUAL8.talkers.map((t) => t.rate)).hidden).toBe(0);
    expect(LAN11.talkers).toHaveLength(11);
    expect(planBlobMesh(LAN11.talkers.map((t) => t.rate)).shownIdx).toHaveLength(7);
  });

  /**
   * Calibration against SwiftShader: #174's floor scan (/workspace/pedant-blob-ant-logs/
   * budget-floor-scan.txt, the old always-draw shader, the pre-hash placement, every radius at the
   * floor) recorded these
   * app five-patch lumas. The mirror must land within 2 luma of each.
   */
  const SCAN: [frameName: "EMPTY" | "LAN7", floor: number, lums: number[]][] = [
    ["EMPTY", 0.16, [154, 152, 57, 205, 159]],
    ["EMPTY", 0.12, [102, 70, 12, 170, 153]],
    ["EMPTY", 0.1, [50, 30, 3, 161, 112]],
    ["EMPTY", 0.08, [15, 7, 0, 155, 48]],
    ["LAN7", 0.16, [198, 92, 155, 149, 151]],
    ["LAN7", 0.12, [167, 26, 88, 63, 66]],
    ["LAN7", 0.1, [159, 8, 41, 26, 28]],
    ["LAN7", 0.08, [153, 1, 12, 6, 6]],
  ];
  for (const [frameName, floor, lums] of SCAN) {
    it(`calibration: ${frameName} at floor ${floor} (old always-draw shader, radii at the floor) matches SwiftShader ${lums.join("/")}`, () => {
      const oldShape = authoredFalloff(SKY)
        .replace(/float drawn = [^;]*;\s*/, "")
        .replace(/float rad = max\([0-9.]+, b\.z\) \* drawn;/, `float rad = max(${floor}, b.z);`);
      expect(mirrorShape(oldShape)).toEqual({ floor, gate: "always", falloff: { kind: "inverse-square" }, skyFloor: 0 });
      const r = darkPatchReport(DARK_PATCH_CASES[frameName], oldShape, floor, "pre-hash", SCAN_LOOK);
      process.stdout.write(`[calibration] ${frameName}@${floor}: mirror ${r.five.lums.join("/")} vs swiftshader ${lums.join("/")}\n`);
      // Within 2 luma wherever SwiftShader read < 100 (the range the dark call is made in); bright
      // blob cores may run up to 8 hot (LAN7 centre patch reads +3..+6: float64 vs float32 and the
      // live frame's positions; EMPTY matches exactly).
      r.five.lums.forEach((v, i) => expect(Math.abs(v - lums[i]!), `patch ${i}: ${r.text}`).toBeLessThanOrEqual(lums[i]! < 100 ? 2 : 8));
    });
  }

  // SINGLE was it.fails (5/5 dark) while first-character angles parked a lone blob off screen.
  for (const [name, frame] of Object.entries(DARK_PATCH_CASES)) {
    it(`${name}: at most ${UXPRO_MAX_DARK} of QE's five app patches are dark`, () => {
      const r = darkPatchReport(frame);
      process.stdout.write(`[dark-patch] ${name}: ${r.text}\n`);
      expect(r.five.dark, r.text).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    });
  }

  /**
   * Floor row: BUSY1_IDLE6's six 1 pkt/s devices are sized by the floor alone next to a 400 pkt/s
   * one, so the floor decides the result. On screen (each written slot at max(shader floor, r)) the
   * quiet devices must be >= 0.12 (the lowest dark-free floor in #174's scan), the whole draw must
   * stay inside the budget, and <= 2 patches may be dark. A lower floor (writer and shader) fails
   * the first; the old 0.16 floor (shader alone, or with the old writer) fails the budget.
   */
  it(`floor decides: BUSY1_IDLE6 draws its quiet devices at >= 0.12, inside the budget on screen, with <= ${UXPRO_MAX_DARK} dark`, () => {
    const r = darkPatchReport(BUSY1_IDLE6);
    process.stdout.write(`[floor-row] BUSY1_IDLE6: ${r.text} onScreenSumR2=${r.onScreenSumR2.toFixed(4)}\n`);
    expect(Math.min(...r.onScreen), `quietest on screen: ${r.text}`).toBeGreaterThanOrEqual(0.12 - 1e-9);
    expect(r.onScreenSumR2, `on-screen sum r^2: ${r.text}`).toBeLessThanOrEqual(BLOB_MESH_SLOT_BUDGET + 1e-6);
    expect(r.five.dark, r.text).toBeLessThanOrEqual(UXPRO_MAX_DARK);
  });

  /**
   * Over time (the lattice drifts): sparse 1, 2 and 3 devices plus every other case, every 5 s from
   * 0 to 60 s, <= 2 dark at every step. Revert: SKY_FLOOR 0.15 (fragment.glsl) -> red (EMPTY, EQUAL7,
   * EQUAL8; red from 0.17 down).
   */
  const PAIR: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 400), talker("172.30.0.31", 1)] };
  const TRIPLE: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 120), talker("172.30.0.11", 60), talker("172.30.0.12", 2)] };
  const SWEPT: [string, VizDataFrame][] = [
    ["SINGLE", SINGLE], ["PAIR", PAIR], ["TRIPLE", TRIPLE],
    ...(Object.entries(DARK_PATCH_CASES) as [string, VizDataFrame][]).filter(([n]) => n !== "SINGLE" && n !== "EMPTY"),
  ];
  for (const [name, frame] of SWEPT) {
    it(`${name} sweep: at most ${UXPRO_MAX_DARK} of five dark at every 5 s step from 0 to 60 s`, () => {
      const rows = Array.from({ length: 13 }, (_, i) => i * 5).map((t) => ({ t, r: darkPatchReport({ ...frame, t }) }));
      process.stdout.write(`[sweep] ${name}: ${rows.map(({ t, r }) => `t${t}=${r.five.dark}`).join(" ")}\n`);
      for (const { t, r } of rows) expect(r.five.dark, `t=${t}: ${r.text}`).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    });
  }


  /**
   * Contrast rows (#174 "Done when"): patch spread (max - min luma over QE's five patches) >= 30
   * and every patch < 240, every 5 s from 0 to 60 s, on the live LAN (LAN7, LAN11) and every other
   * case where the bounds hold honestly (CONTRAST_CASES). A flat or washed sky collapses the spread;
   * a blown-out look pushes a patch to 240+.
   */
  const contrastRow = (name: string, frame: VizDataFrame) => () => {
      const rows = Array.from({ length: 13 }, (_, i) => i * 5).map((t) => ({ t, r: darkPatchReport({ ...frame, t }) }));
      const spreads = rows.map(({ r }) => r.spread);
      const maxes = rows.map(({ r }) => Math.max(...r.five.lums));
      process.stdout.write(`[contrast] ${name}: spread min ${Math.min(...spreads)} (t${rows[spreads.indexOf(Math.min(...spreads))]!.t}), patch max ${Math.max(...maxes)} (t${rows[maxes.indexOf(Math.max(...maxes))]!.t}); spreads ${spreads.join(",")}\n`);
      for (const { t, r } of rows) {
        expect(r.spread, `t=${t} spread: ${r.text}`).toBeGreaterThanOrEqual(MIN_SPREAD);
        expect(Math.max(...r.five.lums), `t=${t} max patch: ${r.text}`).toBeLessThan(MAX_LUMA);
      }
  };
  const swept = (n: string) => SWEPT.find(([m]) => m === n)![1];
  for (const name of CONTRAST_CASES) {
    it(`${name} contrast: patch spread >= ${MIN_SPREAD} and every patch < ${MAX_LUMA} at every 5 s step from 0 to 60 s`, contrastRow(name, swept(name)));
  }

  /**
   * #174 b (UX Pro): size is the only thing that shows rate, and the sky reads as background, so its
   * brightest pixel stays under the dimmest blob. Sky peak and dimmest blob come from the CPU mirror
   * (blobVsSky) with the uniforms the pack draws with at the audio peak (packLook: yml skyBright x
   * the pack's uBright, the pack's uAudio / uAccent). Reverts: the authored r^2/d^2 falloff -> red. (skyBright 1.04 was red on the hashed placement; on the lattice the gap is 31.9 there, see the uniform row.)
   */
  for (const [name, frame] of [["LAN7", LAN7], ["LAN11", LAN11]] as const) {
    it(`${name} sky under the blobs: at the audio peak the sky's brightest pixel is >= ${SKY_UNDER_BLOB_MARGIN} luma under the dimmest blob at every 5 s step from 0 to 60 s`, () => {
      const rows = Array.from({ length: 13 }, (_, i) => i * 5).map((t) => {
        const f = { ...frame, t, audio: AUDIO_PEAK };
        const look = packLook(f);
        return { t, look, r: blobVsSky(f, look.u) };
      });
      const worst = rows.reduce((a, b) => (b.r.dimmestBlob - b.r.skyPeak < a.r.dimmestBlob - a.r.skyPeak ? b : a));
      const text = (x: typeof worst) => `t=${x.t} uBright=${x.look.u.uBright.toFixed(3)} (skyBright ${lookNumber("skyBright")} x pack ${x.look.packBright.toFixed(3)}) `
        + `skyPeak=${x.r.skyPeak.toFixed(1)} dimmestBlob=${x.r.dimmestBlob.toFixed(1)} gap=${(x.r.dimmestBlob - x.r.skyPeak).toFixed(1)}`;
      process.stdout.write(`[sky-under-blob] ${name}: worst ${text(worst)}\n`);
      for (const x of rows) expect(x.r.dimmestBlob - x.r.skyPeak, text(x)).toBeGreaterThanOrEqual(SKY_UNDER_BLOB_MARGIN);
    }, 60_000);
  }

  /**
   * Uniform row (#195 pattern; UX Pro ruling after #193): the contrast rule unchanged at the yml
   * skyBright (1.03). Drive the pack's onFrame at the audio peak on LAN7 and LAN11 at each sampled t,
   * then re-shade each frame at every uBright on a 0.01 grid from UB_LO to UB_HI: the sky's brightest
   * pixel stays >= 5 luma under the dimmest blob. The grid starts at UB_LO = 0.05, not 0: uBright
   * scales the whole picture, so at 0 the frame is black and the gap is 0 (2.6 at 0.02), and no rule
   * on a luma gap can hold there. The pack's own effective uBright (audio 0 to 1) must sit inside the
   * grid. No uBright up to 3 loses the gap on the lattice, so there is no tightest value to pin.
   * #204 slimming, same rule: t every 15 s (5 values, drift phases spread over its ~42 s turn) instead
   * of every 5 s, always including LAN7 t=0, the known worst point (gap 5.3 at uBright 0.05); and one
   * shading pass per frame (skyShades), rescaled per uBright (skyGapAt), which is exact because
   * uBright only multiplies the finished colour (checked against the uncached path below).
   * Revert: UB_LO 0.02 -> red at LAN7 t=0.
   */
  const UB_LO = 0.05;
  const UB_HI = 3;
  /** The every-5-s grid the row used before #204 (13 values), kept only to assert the sparser sampling. */
  const T_DENSE = Array.from({ length: 13 }, (_, i) => i * 5);
  const T_SAMPLES = [0, 15, 30, 45, 60];
  it(`uniform: at skyBright ${lookNumber("skyBright")} the sky stays >= ${SKY_UNDER_BLOB_MARGIN} luma under the dimmest blob on LAN7 and LAN11 at t = ${T_SAMPLES.join(", ")} s (LAN7 t=0 always in), for every uBright from ${UB_LO} to ${UB_HI} (0.01 grid), and the pack's own uBright is inside that range`, () => {
    const live: [string, VizDataFrame][] = [["LAN7", LAN7], ["LAN11", LAN11]];
    const frames = live.flatMap(([name, f]) => T_SAMPLES.map((t) => ({ name, f: { ...f, t, audio: AUDIO_PEAK } })));
    const looks = frames.map(({ f }) => packLook(f));
    const shades = frames.map(({ f }, i) => skyShades(f, looks[i]!.u));
    const grid = Array.from({ length: Math.round((UB_HI - UB_LO) * 100) + 1 }, (_, k) => Math.round(UB_LO * 100 + k) / 100);
    const packRange = [0, AUDIO_PEAK].map((audio) => packLook({ ...LAN7, audio }).u.uBright);
    let worst = { gap: Infinity, at: "" };
    let fails = 0;
    let evals = 0;
    for (const uBright of grid) {
      frames.forEach(({ name, f }, i) => {
        const r = skyGapAt(shades[i]!, uBright);
        evals++;
        const gap = r.dimmestBlob - r.skyPeak;
        if (gap < SKY_UNDER_BLOB_MARGIN) fails++;
        if (gap < worst.gap) worst = { gap, at: `${name} t=${f.t} uBright=${uBright.toFixed(2)} skyPeak=${r.skyPeak.toFixed(1)} dimmestBlob=${r.dimmestBlob.toFixed(1)}` };
      });
    }
    const text = `skyBright ${lookNumber("skyBright")}; pack uBright ${packRange.map((u) => u.toFixed(3)).join(" to ")} (audio 0 to ${AUDIO_PEAK}); worst gap ${worst.gap.toFixed(1)} at ${worst.at}; ${fails} (uBright, frame) pairs under ${SKY_UNDER_BLOB_MARGIN}; ${frames.length} frames x ${grid.length} uBright = ${evals} gap evaluations from ${shades.length} shading passes`;
    process.stdout.write(`[sky-uniform] ${text}\n`);
    // the rule (first, so a moved grid start fails here, at the frame where it breaks)
    expect(worst.gap, text).toBeGreaterThanOrEqual(SKY_UNDER_BLOB_MARGIN);
    expect(lookNumber("skyBright"), text).toBe(1.03);
    for (const u of packRange) expect(u >= UB_LO && u <= UB_HI, `pack uBright inside the grid: ${text}`).toBe(true);
    // the sampling, structurally: rule unchanged, fewer t, the known worst point always in
    expect(SKY_UNDER_BLOB_MARGIN, "margin unchanged").toBe(5);
    expect([grid[0], grid[grid.length - 1], grid.length], "uBright grid 0.05 to 3 in 0.01 steps").toEqual([0.05, 3, 296]);
    expect(T_SAMPLES.length, "fewer t values than the every-5-s grid").toBeLessThan(T_DENSE.length);
    expect(T_SAMPLES.every((t) => T_DENSE.includes(t)), "sampled t are on the old grid").toBe(true);
    expect(frames.some(({ name, f }) => name === "LAN7" && f.t === 0), "LAN7 t=0 (the known worst point) is sampled").toBe(true);
    // the cache is exact: the uncached path at both grid ends and the pack's uBright, LAN7 t=0
    const i0 = frames.findIndex(({ name, f }) => name === "LAN7" && f.t === 0);
    for (const ub of [grid[0]!, looks[i0]!.u.uBright, grid[grid.length - 1]!]) {
      expect(skyGapAt(shades[i0]!, ub), `cached = uncached at uBright ${ub}`).toEqual(blobVsSkyDirect(frames[i0]!.f, { ...looks[i0]!.u, uBright: ub }));
    }
  }, 600_000);

  /**
   * #193 (UX Pro spec): a steeper falloff with compact support, the iso threshold left alone. The
   * cutoff is the shader's BLOB_GAP (read from fragment.glsl, never retyped here): a blob's field is
   * exactly 1 at its radius and exactly 0 from rad + BLOB_GAP / 2 out, so the merge distance of two
   * blobs is r1 + r2 + BLOB_GAP. Revert: the authored r^2/d^2 line -> red.
   */
  it("#193 compact falloff: each blob's field is 1 at its radius and exactly 0 from rad + BLOB_GAP / 2 out (BLOB_GAP read from the shader), threshold unchanged", () => {
    const shape = mirrorShape(SKY);
    expect(SKY, "iso threshold unchanged").toContain("float iso = smoothstep(0.55, 1.25, field + 0.45 + uAudio * 0.3);");
    expect(shape.falloff.kind, "fragment.glsl blob falloff").toBe("compact");
    const gap = shaderConst(SKY, "BLOB_GAP");
    expect(gap, "BLOB_GAP in fragment.glsl").not.toBeNull();
    expect(gap!).toBeGreaterThan(0);
    for (const rad of [BLOB_MESH_FLOOR, 0.132, 0.168, 0.343]) {
      const reach = rad + 0.5 * gap!;
      expect(blobContrib(rad, rad * rad, shape.falloff), `rad ${rad}: field at the radius`).toBeCloseTo(1, 9);
      for (const d of [reach, reach + 1e-4, reach + 0.05, 1, 3]) expect(blobContrib(rad, d * d, shape.falloff), `rad ${rad}: field at ${d.toFixed(4)} (reach ${reach.toFixed(4)})`).toBe(0);
      expect(blobContrib(rad, (reach - 0.005) ** 2, shape.falloff), `rad ${rad}: field just inside the reach`).toBeGreaterThan(0);
    }
  });

  /**
   * The merge distance on the shader's field: two blobs set r1 + r2 + BLOB_GAP (+1e-4) apart leave a
   * point between them where the summed field is exactly 0 (no bridge); 0.01 closer, every point on
   * the path between their centres (401 samples) has field > 0, so they join.
   */
  it("#193 merge distance: two blobs r1 + r2 + BLOB_GAP apart leave a point of exactly 0 field between them; 0.01 closer they join", () => {
    const shape = mirrorShape(SKY);
    const gap = shaderConst(SKY, "BLOB_GAP")!;
    const pairs: [number, number][] = [[BLOB_MESH_FLOOR, BLOB_MESH_FLOOR], [0.168, 0.132], [0.168, BLOB_MESH_FLOOR], [0.343, BLOB_MESH_FLOOR]];
    for (const [r1, r2] of pairs) {
      const md = mergeDistance(r1, r2, shape.falloff);
      expect(md, `merge distance for ${r1} + ${r2}`).toBeCloseTo(r1 + r2 + gap, 12);
      const field = (x: number, d: number) => blobContrib(r1, x * x, shape.falloff) + blobContrib(r2, (d - x) ** 2, shape.falloff);
      const d = md + 1e-4;
      expect(field(r1 + 0.5 * gap + 5e-5, d), `r ${r1} + ${r2} at ${d.toFixed(4)}: field in the gap`).toBe(0);
      const near = md - 0.01;
      const lows = Array.from({ length: 401 }, (_, k) => field((near * k) / 400, near));
      expect(Math.min(...lows), `r ${r1} + ${r2} at ${near.toFixed(4)}: lowest field on the path`).toBeGreaterThan(0);
    }
  });

  /**
   * #193 acceptance (UX Pro via ZotoBoss: 4 of 7 clearly separate, lattice placement) on the REAL
   * placement: LAN7 and LAN11, every 5 s from 0 to 60 s in one sequence (the site map carries
   * across steps like the app's tile), blobs at blobMeshPlacement(id, t, sites), cross-checked
   * against the slots the app draws. Merge distance r1 + r2 + BLOB_GAP with BLOB_GAP read from
   * fragment.glsl. At every step: every drawn centre inside the safe ellipse; the busiest 4 hold 4
   * distinct sites and every pair of them is at least its merge distance apart; the 7 blobs form at
   * least 4 separate lumps (no blob within merge distance of two site lumps). Strict isolation of 4
   * (each >= merge distance from all 6 others) can't fit: the other 3 have to sit somewhere in the
   * ellipse, and every point of it is within 0.36 of a site; they join a site's lump instead.
   * Reverts: today's hashed placement -> red; the authored r^2/d^2 falloff (merge distance
   * Infinity) -> red.
   */
  it("#193 acceptance on the real blobMeshPlacement: LAN7 and LAN11 keep every centre inside the safe ellipse and >= 4 of 7 clearly separated at the shader's merge distance (busiest 4 on distinct sites, 4 lumps) at every 5 s step from 0 to 60 s", () => {
    const shape = mirrorShape(SKY);
    const gap = shaderConst(SKY, "BLOB_GAP");
    expect(shape.falloff.kind, "merge distance needs the compact falloff (fragment.glsl)").toBe("compact");
    expect(gap !== null && gap > 0, "BLOB_GAP read from fragment.glsl and > 0").toBe(true);
    for (const [x, y] of BLOB_MESH_SITES) expect(inSafeEllipse(x, y), `site (${x}, ${y}) inside the safe ellipse`).toBe(true);
    const lines: string[] = [];
    const live: [string, VizDataFrame][] = [["LAN7", LAN7], ["LAN11", LAN11]];
    for (const [name, frame] of live) {
      const sites: BlobMeshSiteMap = new Map();
      const tile = `accept-${name}-${hostTiles++}`;
      for (let t = 0; t <= 60; t += 5) {
        const blobs = placedStep(frame, t, shape, sites, tile);
        expect(blobs, `${name} t=${t}: drawn`).toHaveLength(7);
        for (const b of blobs) expect(inSafeEllipse(b.x, b.y), `${name} t=${t}: ${b.id} (${b.x.toFixed(3)}, ${b.y.toFixed(3)}) inside the safe ellipse`).toBe(true);
        const holders = blobs.filter((b) => b.site !== undefined);
        let closest = { d: Infinity, merge: Infinity, ids: "" };
        for (let i = 0; i < holders.length; i++) for (let j = i + 1; j < holders.length; j++) {
          const A = holders[i]!, B = holders[j]!;
          const d = Math.hypot(A.x - B.x, A.y - B.y);
          if (d - mergeDistance(A.r, B.r, shape.falloff) < closest.d - closest.merge || closest.ids === "") closest = { d, merge: mergeDistance(A.r, B.r, shape.falloff), ids: `${A.id}/${B.id}` };
        }
        const lumps = blobLumps(blobs, shape.falloff);
        const strict = separatedBlobs(blobs, shape.falloff);
        const why = `${name} t=${t}: holders ${holders.map((h) => `${h.id}@${h.site}`).join(" ")}; closest holder pair ${closest.ids} ${closest.d.toFixed(4)} uv vs merge ${closest.merge.toFixed(4)}; ${lumps} lumps; ${strict} of 7 strictly isolated`;
        lines.push(why);
        expect(new Set(holders.map((h) => h.site)).size, `4 distinct sites: ${why}`).toBe(4);
        expect(closest.d, `busiest 4 pairwise apart: ${why}`).toBeGreaterThanOrEqual(closest.merge);
        expect(lumps, `>= 4 separate lumps: ${why}`).toBeGreaterThanOrEqual(4);
      }
    }
    process.stdout.write(`[separation] acceptance:\n  ${lines.join("\n  ")}\n`);
  });
  /**
   * #193 small counts (UX Pro: fewer devices must never make blobs harder to tell apart), on the
   * REAL sizing and placement: frames of 1 to 6 devices (LAN7's busiest n, n equal devices, and two
   * tied for busiest over quieter ones), every 5 s from 0 to 60 s with the site map carried and the
   * host slots cross-checked. With 3 or fewer drawn every pair is at least its merge distance apart
   * (n lumps); with 4 to 6 the busiest 4 are pairwise apart (the others may join a site's lump).
   * Merge distance r1 + r2 + BLOB_GAP from fragment.glsl, radii from planBlobMesh.
   * Revert: planBlobMesh growing small counts into the whole budget uncapped -> red.
   */
  it("#193 small counts: 1 to 6 devices keep every blob (<= 3 drawn) or the busiest 4 (4 to 6 drawn) pairwise apart at the shader's merge distance, inside the safe ellipse, every 5 s from 0 to 60 s", () => {
    const shape = mirrorShape(SKY);
    expect(shape.falloff.kind, "merge distance needs the compact falloff (fragment.glsl)").toBe("compact");
    const t = (id: string, rate: number) => ({ id, rate, role: "lan" });
    const families: [string, (n: number) => VizDataFrame | null][] = [
      ["LAN7 top", (n) => ({ ...LAN7, talkers: [...LAN7.talkers].sort((a, b) => b.rate - a.rate).slice(0, n) })],
      ["equal", (n) => ({ ...LAN7, talkers: Array.from({ length: n }, (_, i) => t(`10.9.0.${10 + i}`, 60)) })],
      ["tied top", (n) => (n < 2 ? null : { ...LAN7, talkers: Array.from({ length: n }, (_, i) => t(`10.8.0.${10 + i}`, i < 2 ? 100 : 40 - i)) })],
    ];
    const lines: string[] = [];
    for (let n = 1; n <= 6; n++) {
      for (const [fam, make] of families) {
        const frame = make(n);
        if (!frame) continue;
        const sites: BlobMeshSiteMap = new Map();
        const tile = `small-${fam}-${n}-${hostTiles++}`;
        let closest = { margin: Infinity, text: "no pair" };
        for (let step = 0; step <= 60; step += 5) {
          const blobs = placedStep(frame, step, shape, sites, tile);
          expect(blobs, `${fam} n=${n} t=${step}: drawn`).toHaveLength(n);
          for (const b of blobs) expect(inSafeEllipse(b.x, b.y), `${fam} n=${n} t=${step}: ${b.id} inside the safe ellipse`).toBe(true);
          const judged = n <= 3 ? blobs : blobs.filter((b) => b.site !== undefined);
          if (n > 3) expect(judged, `${fam} n=${n} t=${step}: 4 site holders`).toHaveLength(4);
          for (let i = 0; i < judged.length; i++) for (let j = i + 1; j < judged.length; j++) {
            const A = judged[i]!, B = judged[j]!;
            const d = Math.hypot(A.x - B.x, A.y - B.y);
            const md = mergeDistance(A.r, B.r, shape.falloff);
            const why = `${fam} n=${n} t=${step}: ${A.id} r=${A.r.toFixed(4)} / ${B.id} r=${B.r.toFixed(4)} ${d.toFixed(4)} uv vs merge ${md.toFixed(4)}`;
            if (d - md < closest.margin) closest = { margin: d - md, text: why };
            expect(d, `pairwise apart: ${why}`).toBeGreaterThanOrEqual(md);
          }
          if (n <= 3) expect(blobLumps(blobs, shape.falloff), `${fam} n=${n} t=${step}: every blob its own lump`).toBe(n);
        }
        lines.push(`${fam} n=${n}: radii ${planBlobMesh(frame.talkers.map((d) => d.rate)).radii.map((r) => r.toFixed(4)).join(",")}; closest ${closest.text}`);
      }
    }
    process.stdout.write(`[small-counts]\n  ${lines.join("\n  ")}\n`);
  });
});
