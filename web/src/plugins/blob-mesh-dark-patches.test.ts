import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOB_MESH_FLOOR, BLOB_MESH_SLOT_BUDGET, planBlobMesh } from "../../../plugins/sdk/blob-mesh-budget";
import { themeById } from "../core/themes";
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
import { runPackFrameHandler } from "./viz-pack-host";
import { VIZ_UBO, type VizDataFrame, type VizUniformValue } from "./viz-host";

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
type Shape = { floor: number; gate: Gate };

/** Read the two lines this row is about from the shader; refuse to guess on anything else. */
export function mirrorShape(src: string): Shape {
  const floorM = src.match(/float rad = max\(([0-9.]+), b\.z\)( \* drawn)?;/);
  if (!floorM) throw new Error("blob-mesh sky: `float rad = max(<floor>, b.z)` not found; update the CPU mirror");
  const floor = Number(floorM[1]);
  if (!floorM[2]) return { floor, gate: "always" };
  if (/float drawn = max\(step\(0\.001, b\.z\), 1\.0 - live\);/.test(src)) return { floor, gate: "live-gated" };
  if (/float drawn = step\(0\.001, b\.z\);/.test(src)) return { floor, gate: "only-written" };
  throw new Error("blob-mesh sky: unrecognised `drawn` gate; update the CPU mirror");
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
    const contrib = (rad * rad) / Math.max(0.0012, dx * dx + dy * dy);
    field += contrib;
    tint = mix3(tint, mix3(u.uAccent, [0.15, 1.0, 0.72], Math.max(bw, fi / 8)), clamp(contrib * 0.12, 0, 0.4));
  }
  const iso = smoothstep(0.55, 1.25, field + 0.45 + u.uAudio * 0.3);
  const bg = u.uBg.map((c) => c * 0.12);
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

/** The pack's own look (visualisation.yml skyBright / skyOpacity), so a look change reaches these rows. */
const LOOK_YML = readFileSync(path.resolve(here, "../../../plugins/src/blob-mesh/visualisation.yml"), "utf8");
function lookNumber(key: string): number {
  const m = LOOK_YML.match(new RegExp(`^\\s+${key}: ([0-9.]+)\\s*$`, "m"));
  if (!m) throw new Error(`blob-mesh visualisation.yml: look.${key} not found`);
  return Number(m[1]);
}
const LOOK_THEME = themeById(LOOK_YML.match(/^\s+theme: ([a-z0-9-]+)\s*$/m)?.[1]);
/** The pack look as the host applies it: yml skyBright / skyOpacity, the yml theme's scene rim and bg. */
function appLook(skyBright = lookNumber("skyBright")): PluginSkySmokeUniforms {
  return hostLookUniforms({ skyBright, skyOpacity: lookNumber("skyOpacity"), rim: LOOK_THEME.scene.rim, bg: Number.parseInt(LOOK_THEME.ui.bg.slice(1), 16) });
}
/**
 * The uniforms the plugin sky actually draws with once the pack writes (#180 H1 on main): the
 * host look (yml skyBright / skyOpacity, theme bg) times the pack's own uBright / uOpacity (pack
 * default 1), and the pack's uTime / uAudio / uAccent / uBg where it writes them. The pack writes
 * come from its onFrame (runPackFrameHandler, the host mirror of frontend/index.ts).
 */
export function packLook(frame: VizDataFrame, skyBright = lookNumber("skyBright")): { u: PluginSkySmokeUniforms; packBright: number } {
  const w: Record<string, VizUniformValue> = {};
  runPackFrameHandler("blob-mesh", frame, { writeBuffer: () => {}, writeUniform: (n, v) => { w[n] = v; }, writeParticles: () => {} });
  const host = { ...appLook(skyBright), uAudio: frame.audio };
  const num = (k: string) => (typeof w[k] === "number" ? (w[k] as number) : undefined);
  const vec = (k: string) => (Array.isArray(w[k]) ? (w[k] as number[]) : undefined);
  const packBright = num("uBright") ?? 1;
  return {
    packBright,
    u: {
      uTime: num("uTime") ?? host.uTime,
      uOpacity: host.uOpacity * (num("uOpacity") ?? 1),
      uBright: host.uBright * packBright,
      uAudio: num("uAudio") ?? host.uAudio,
      uAccent: vec("uAccent") ?? host.uAccent,
      uBg: vec("uBg") ?? host.uBg,
    } as PluginSkySmokeUniforms,
  };
}
/** The look #174's SwiftShader floor scan rendered (calibration rows only). */
const SCAN_LOOK = hostLookUniforms({ skyBright: 1.18, skyOpacity: 0.96, rim: 0x4cc9f0, bg: 0x0b141c });
const RAY = parentedSkyRay("blob-mesh", SKY, HOST_DEFAULT_PITCH_DEG);
const SPAN = appLensSkySpan();

function hostSlots(frame: VizDataFrame): Float32Array {
  const slots = new Float32Array(VIZ_UBO.totalFloats);
  runPackFrameHandler("blob-mesh", frame, {
    writeBuffer: (slot, data) => {
      slots.fill(0, slot * VIZ_UBO.slotFloats, (slot + 1) * VIZ_UBO.slotFloats);
      slots.set(data, slot * VIZ_UBO.slotFloats);
    },
    writeUniform: () => {},
    writeParticles: () => {},
  });
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
export function blobVsSky(frame: VizDataFrame, look = packLook(frame).u, src = SKY): { skyPeak: number; dimmestBlob: number } {
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
const CONTRAST_CASES = ["LAN7", "LAN11", "PAIR", "TRIPLE", "EQUAL7", "EQUAL8", "BUSY1_IDLE6", "LOW_BESIDE_BUSY", "HALF", "FULL8"] as const;
/**
 * Known gaps at the #174 b sky (UX Pro to decide, see the #174 thread): a lone device (SINGLE,
 * spread min 27) and a quiet LAN (QUIET5, 5 devices at 0.5 pkt/s: the pack's uBright falls to
 * 0.806, spread min 16) stay under 30 at every sky value that keeps the sky under the blobs.
 * it.fails: turns red once they reach the bounds, so the row can move into CONTRAST_CASES.
 */
const CONTRAST_GAPS = ["SINGLE", "QUIET5"] as const;
/** #174 b (UX Pro): the sky's brightest pixel sits at least this far (luma) under the dimmest blob. */
const SKY_UNDER_BLOB_MARGIN = 5;
/** The audio peak (frame.audio is 0..1): the pack's uBright and the shader's iso both rise with it. */
const AUDIO_PEAK = 1;

export const DARK_PATCH_CASES = { LAN7, LAN11, EQUAL7, EQUAL8, BUSY1_IDLE6, SINGLE, QUIET5, LOW_BESIDE_BUSY, HALF, FULL8, EMPTY } as const;

describe(`blob-mesh dark patches on a CPU mirror of the sky (budget ${BLOB_MESH_SLOT_BUDGET.toFixed(4)}, floor ${BLOB_MESH_FLOOR})`, () => {
  it("mirror inputs: the live LAN frame is 7 devices at 420 pkt/s and the shader floor is the writers' floor", () => {
    expect(LAN7.talkers).toHaveLength(7);
    expect(LAN7.talkers.reduce((s, t) => s + t.rate, 0)).toBe(LAN_35S_PPS);
    expect(mirrorShape(SKY)).toEqual({ floor: BLOB_MESH_FLOOR, gate: "live-gated" });
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
      const oldShape = SKY
        .replace(/float drawn = [^;]*;\s*/, "")
        .replace(/float rad = max\([0-9.]+, b\.z\) \* drawn;/, `float rad = max(${floor}, b.z);`);
      expect(mirrorShape(oldShape)).toEqual({ floor, gate: "always" });
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

  /** Over time (spread placement drifts): sparse 1, 2 and 3 devices plus every other case, every 5 s from 0 to 60 s, <= 2 dark at every step. */
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
  for (const name of CONTRAST_GAPS) {
    it.fails(`${name} contrast (known gap, it.fails): patch spread >= ${MIN_SPREAD} and every patch < ${MAX_LUMA} at every 5 s step from 0 to 60 s`, contrastRow(name, swept(name)));
  }

  /**
   * #174 b (UX Pro): size is the only thing that shows rate, and the sky reads as background, so its
   * brightest pixel stays under the dimmest blob. Sky peak and dimmest blob come from the CPU mirror
   * (blobVsSky) with the uniforms the pack draws with at the audio peak (packLook: yml skyBright x
   * the pack's uBright, the pack's uAudio / uAccent). Revert: skyBright 1.18 -> red.
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
   * Uniform row (#195 pattern): drive the pack's onFrame at the audio peak, read the effective sky
   * uBright from the uniforms (yml skyBright x pack uBright), and hold it at or under the brightest
   * uBright the mirror allows with the sky >= 5 luma under the dimmest blob (found here by bisection
   * on the same mirror and uniforms, so no copy of either number lives in the test).
   */
  it(`uniform: the pack's effective sky uBright at the audio peak (LAN7) is at most the brightest that keeps the sky >= ${SKY_UNDER_BLOB_MARGIN} luma under the dimmest blob`, () => {
    const frames = Array.from({ length: 13 }, (_, i) => ({ ...LAN7, t: i * 5, audio: AUDIO_PEAK }));
    const looks = frames.map((f) => packLook(f).u);
    const clears = (uBright: number) => frames.every((f, i) => {
      const r = blobVsSky(f, { ...looks[i]!, uBright });
      return r.dimmestBlob - r.skyPeak >= SKY_UNDER_BLOB_MARGIN;
    });
    let lo = 0.5, hi = 2;
    expect(clears(lo), "bisection floor must clear").toBe(true);
    expect(clears(hi), "bisection ceiling must not clear").toBe(false);
    while (hi - lo > 0.002) { const mid = (lo + hi) / 2; if (clears(mid)) lo = mid; else hi = mid; }
    const eff = looks[0]!.uBright;
    const text = `effective uBright ${eff.toFixed(3)} (skyBright ${lookNumber("skyBright")} x pack uBright ${packLook(frames[0]!).packBright.toFixed(3)} at audio ${AUDIO_PEAK}) vs brightest clearing ${lo.toFixed(3)}`;
    process.stdout.write(`[sky-uniform] LAN7: ${text}\n`);
    expect(new Set(looks.map((u) => u.uBright)).size, "uBright does not move with t").toBe(1);
    expect(eff, text).toBeLessThanOrEqual(lo);
  }, 120_000);
});
