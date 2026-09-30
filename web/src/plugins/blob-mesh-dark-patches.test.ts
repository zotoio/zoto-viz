import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOB_MESH_FLOOR, BLOB_MESH_SLOT_BUDGET, planBlobMesh } from "../../../plugins/sdk/blob-mesh-budget";
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
import { VIZ_UBO, type VizDataFrame } from "./viz-host";

/**
 * #174 dark-patch rows on a CPU mirror of plugins/src/blob-mesh/sky/fragment.glsl (no browser).
 *
 * Same inputs as the SwiftShader production row in blob-mesh-sky.test.ts ("lights the wall for a
 * 7-talker 420 pkt/s LAN at the host camera"): host-mirror slot 0, the blob-mesh app look
 * (hostLookUniforms: skyBright 1.18, rim 0x4cc9f0, bg 0x0b141c, uTime 3, uAudio 0), the camera
 * ray from parentedSkyRay at pitch 45 over appLensSkySpan, a 128 x 128 draw, and QE's app
 * five patches (appFivePatches: 3 x 3 px at the centre and quarter points of APP_QE_REGION;
 * a patch is dark below luma 24, pass needs <= 2 dark). "Dark patch" here is that five-patch rule,
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

const APP_LOOK = hostLookUniforms({ skyBright: 1.18, skyOpacity: 0.96, rim: 0x4cc9f0, bg: 0x0b141c });
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

export function darkPatchReport(frame: VizDataFrame, src = SKY, radiusOverride?: number) {
  const shape = mirrorShape(src);
  const slots = hostSlots(frame);
  if (radiusOverride !== undefined) for (let i = 0; i < 8; i++) if (slots[i * 4 + 2]! > 0) slots[i * 4 + 2] = radiusOverride;
  const luma = cpuLuma(slots, APP_LOOK, RAY, SPAN, shape);
  const five = fivePatchSummary(appFivePatches(luma));
  const radii: number[] = [];
  for (let i = 0; i < 8; i++) if (slots[i * 4 + 2]! > 0) radii.push(slots[i * 4 + 2]!);
  const sumR2 = radii.reduce((s, r) => s + r * r, 0);
  const spread = Math.max(...five.lums) - Math.min(...five.lums);
  const regions = connectedDarkRegions(luma);
  const text = `${five.text} spread=${spread} max=${Math.max(...five.lums)} connectedDarkRegions=${regions} `
    + `radii=${radii.map((r) => r.toFixed(3)).join(",")} sumR2=${sumR2.toFixed(4)} floor=${shape.floor} gate=${shape.gate}`;
  return { five, spread, regions, sumR2, text };
}

const EMPTY: VizDataFrame = { t: 35, dt: 1 / 6, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
const talker = (ip: string, rate: number, role = "lan") => ({ id: ip, rate, role });
const LAN7 = lanFrames35s({ fixture: "host" }, 2)[0]!;
const EQUAL7: VizDataFrame = { ...EMPTY, talkers: ["104.18.32.7", "142.250.66.14", "172.30.0.1", "172.30.0.10", "172.30.0.21", "172.30.0.22", "172.30.0.23"].map((ip) => talker(ip, 60)) };
const BUSY1_IDLE6: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 400), ...[1, 2, 3, 4, 5, 6].map((i) => talker(`172.30.0.${30 + i}`, 1))] };
const SINGLE: VizDataFrame = { ...EMPTY, talkers: [talker("172.30.0.10", 300)] };
const FULL8: VizDataFrame = { ...EMPTY, talkers: Array.from({ length: 8 }, (_, i) => talker(`172.30.0.${10 + i}`, 120 - i * 12, i === 1 ? "gateway" : "lan")) };

const LAN11 = lanFrames35s({ fixture: "host" }, 2, 1, 6, 11)[0]!;

export const DARK_PATCH_CASES = { LAN7, LAN11, EQUAL7, BUSY1_IDLE6, SINGLE, FULL8, EMPTY } as const;

describe(`blob-mesh dark patches on a CPU mirror of the sky (budget ${BLOB_MESH_SLOT_BUDGET.toFixed(4)}, floor ${BLOB_MESH_FLOOR})`, () => {
  it("mirror inputs: the live LAN frame is 7 devices at 420 pkt/s and the shader floor is the writers' floor", () => {
    expect(LAN7.talkers).toHaveLength(7);
    expect(LAN7.talkers.reduce((s, t) => s + t.rate, 0)).toBe(LAN_35S_PPS);
    expect(mirrorShape(SKY)).toEqual({ floor: BLOB_MESH_FLOOR, gate: "live-gated" });
    // 8 devices draw 7 since the growth reserve (the 8th is dropped and the notice says so)
    expect(planBlobMesh(FULL8.talkers.map((t) => t.rate)).hidden).toBe(1);
    expect(LAN11.talkers).toHaveLength(11);
    expect(planBlobMesh(LAN11.talkers.map((t) => t.rate)).shownIdx).toHaveLength(7);
  });

  /**
   * Calibration against SwiftShader: #174's floor scan (/workspace/pedant-blob-ant-logs/
   * budget-floor-scan.txt, the old always-draw shader, every radius at the floor) recorded these
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
      const r = darkPatchReport(DARK_PATCH_CASES[frameName], oldShape, floor);
      process.stdout.write(`[calibration] ${frameName}@${floor}: mirror ${r.five.lums.join("/")} vs swiftshader ${lums.join("/")}\n`);
      // Within 2 luma wherever SwiftShader read < 100 (the range the dark call is made in); bright
      // blob cores may run up to 8 hot (LAN7 centre patch reads +3..+6: float64 vs float32 and the
      // live frame's positions; EMPTY matches exactly).
      r.five.lums.forEach((v, i) => expect(Math.abs(v - lums[i]!), `patch ${i}: ${r.text}`).toBeLessThanOrEqual(lums[i]! < 100 ? 2 : 8));
    });
  }

  /**
   * SINGLE is a known fail at this budget/floor, kept visible with it.fails (not tuned here; the
   * budget is retuned later): one device draws one blob (radius 0.22) and, with no idle blobs,
   * nothing else lights the dome, so all five app patches read 0 (5/5 dark). If a later change
   * lights the single-device tile, this row flips and it.fails must come off.
   */
  const KNOWN_DARK: ReadonlySet<string> = new Set(["SINGLE"]);
  for (const [name, frame] of Object.entries(DARK_PATCH_CASES)) {
    (KNOWN_DARK.has(name) ? it.fails : it)(`${name}: at most ${UXPRO_MAX_DARK} of QE's five app patches are dark${KNOWN_DARK.has(name) ? " (known fail, #174)" : ""}`, () => {
      const r = darkPatchReport(frame);
      process.stdout.write(`[dark-patch] ${name}: ${r.text}\n`);
      expect(r.five.dark, r.text).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    });
  }
});
