import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapPluginSky } from "./plugin-sky-probe";
import {
  assertPluginSkySmokeDraws,
  closePluginSkySmokeBrowser,
  smokeRenderPluginSky,
  type PluginSkySmokeResult,
  type PluginSkySmokeUniforms,
} from "./plugin-sky-smoke-render";
import { mergeVizIdleFrame, VIZ_UBO, type VizDataFrame } from "./viz-host";
import {
  atHostCamera,
  HOST_DEFAULT_PITCH_DEG,
  IDENTITY_SKY_RAY,
  parentedSkyRay,
  worldDomeSkyRay,
  type SkyRay,
} from "./pack-sky-host-camera-test-helper";

/**
 * Cypher CIC (authored 2026-09-19/20, before 2f44932a parented plugin skies to the camera)
 * draws its floor grid (`dir.xz / max(0.04, -floorY)`) and circuit traces
 * (`dir.xz / (0.22 + |dir.y|)`) as world-dome projections of the host camera's default
 * 45 degree look-down. On today's level camera-local ray the floor only shows its far-field
 * vanishing band along the bottom of the view and the trace disc sits off screen (faded to 0).
 * Each row renders one of those layers on its own at the host 55 degree view and compares it
 * with the authored world-dome render at the default graph camera.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rawSky = readFileSync(path.resolve(here, "../../../plugins/src/cypher-cic/sky/fragment.glsl"), "utf8");

/** The authored (650add60) sky: the fix's `dome` ray folded back to the plain vDir read. */
const AUTHORED_SKY = rawSky
  .replace(/\n\s*vec3 dome = normalize\(vec3\(dir\.x,[^;]*;/, "")
  .replace(/\bdome\./g, "dir.")
  .replace("float floorY = dir.y + 0.12;", "float floorY = lat + 0.12;");

/** Plugin sky uniforms before any pack write (neon theme, cypher-cic look skyBright 1.05). */
const HOST_DEFAULTS: PluginSkySmokeUniforms = {
  uTime: 3,
  uOpacity: 1,
  uBright: 1.05,
  uAudio: 0,
  uAccent: [0, 0xe5 / 255, 1],
  uBg: [0x05 / 255, 0, 0x12 / 255],
};

const FINAL_COLOR = "fragColor = vec4(col * max(uBright, 0.78) * vig, max(uOpacity, 0.9));";

function once(src: string, find: string | RegExp, replace: string, what: string): string {
  const n = typeof find === "string" ? src.split(find).length - 1 : (src.match(new RegExp(find, "g"))?.length ?? 0);
  expect(n, `${what}: expected one match in the cypher-cic sky`).toBe(1);
  return src.replace(find, replace);
}

/** Output only the floor grid ink (line * fade) that line ~140's projection drives. */
function floorLayer(src: string): string {
  let s = once(src, /float floorY = /, "float zzFloorInk = 0.0;\n  float floorY = ", "floor start");
  s = once(s, "float fade = exp(floorY * 3.2);", "float fade = exp(floorY * 3.2);\n    zzFloorInk = line * fade;", "floor ink");
  return once(s, FINAL_COLOR, "fragColor = vec4(vec3(zzFloorInk * 2.0), 1.0);", "final colour");
}

/** Output only where the floor is drawn at all (its fade weight), i.e. how much of the view is floor. */
function floorCoverLayer(src: string): string {
  let s = once(src, /float floorY = /, "float zzFloorFade = 0.0;\n  float floorY = ", "floor start");
  s = once(s, "float fade = exp(floorY * 3.2);", "float fade = exp(floorY * 3.2);\n    zzFloorFade = fade;", "floor fade");
  return once(s, FINAL_COLOR, "fragColor = vec4(vec3(zzFloorFade * 2.0), 1.0);", "final colour");
}

/** Output only the hex circuit-trace mask that line ~170's projection drives. */
function tracesLayer(src: string): string {
  return once(src, FINAL_COLOR, "fragColor = vec4(vec3(grid), 1.0);", "final colour");
}

function wrappedSky(src: string, ray: SkyRay = IDENTITY_SKY_RAY): string {
  const w = wrapPluginSky(atHostCamera(src, ray));
  if ("error" in w) throw new Error(w.error);
  return w.frag;
}

type PackOut = { slots: Float32Array; uniforms: PluginSkySmokeUniforms };

let onFrame: ((frame: VizDataFrame) => void) | null = null;
let written: Record<string, number | [number, number, number]> = {};
let slots = new Float32Array(VIZ_UBO.totalFloats);

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => ({}),
    writeBuffer: (slot: number, data: number[] | Float32Array) => {
      slots.set(Array.from(data).slice(0, VIZ_UBO.slotFloats), slot * VIZ_UBO.slotFloats);
    },
    writeUniform: (name: string, value: number | [number, number, number]) => {
      written[name] = value;
    },
    writeParticles: () => {},
  };
  await import("../../../plugins/src/cypher-cic/frontend/index");
  onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
});

afterAll(async () => {
  delete (globalThis as { zoto?: unknown }).zoto;
  await closePluginSkySmokeBrowser();
});

const EMPTY: VizDataFrame = { t: 3, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

function runPack(frame: VizDataFrame): PackOut {
  expect(onFrame, "cypher-cic frontend registers host.onFrame").toBeTypeOf("function");
  slots = new Float32Array(VIZ_UBO.totalFloats);
  written = {};
  onFrame!(frame);
  expect(slots[12], "slot 0 carries the canvas width").toBeGreaterThan(64);
  const u = written;
  return {
    slots,
    uniforms: {
      ...HOST_DEFAULTS,
      uAudio: typeof u.uAudio === "number" ? u.uAudio : 0,
      uAccent: Array.isArray(u.uAccent) ? u.uAccent : HOST_DEFAULTS.uAccent,
      uBg: Array.isArray(u.uBg) ? u.uBg : HOST_DEFAULTS.uBg,
    },
  };
}

function sameLayer(now: PluginSkySmokeResult, authored: PluginSkySmokeResult, label: string): void {
  const msg = `${label}: now ${now.assertion} vs authored ${authored.assertion}`;
  console.info(`[cypher-cic-sky] ${msg}`);
  expect(Math.abs(now.litPixelFraction - authored.litPixelFraction), msg).toBeLessThan(0.02);
  expect(Math.abs(now.medianLuma - authored.medianLuma), msg).toBeLessThan(0.02);
}

async function layerAtDefaultCamera(layer: (src: string) => string, out: PackOut) {
  const authored = await smokeRenderPluginSky(
    wrappedSky(layer(AUTHORED_SKY), worldDomeSkyRay(HOST_DEFAULT_PITCH_DEG)), out.slots, out.uniforms);
  const now = await smokeRenderPluginSky(
    wrappedSky(layer(rawSky), parentedSkyRay("cypher-cic", rawSky, HOST_DEFAULT_PITCH_DEG)), out.slots, out.uniforms);
  return { authored, now };
}

describe("cypher-cic sky on the host camera", () => {
  it("folds back to the authored sky for the world-dome reference", () => {
    expect(AUTHORED_SKY).not.toMatch(/vec3 dome|\bdome\./);
    expect(AUTHORED_SKY).toContain("vec2 gp = dir.xz / max(0.04, -floorY);");
    expect(AUTHORED_SKY).toContain("vec2 traces = dir.xz / (0.22 + abs(dir.y));");
    expect(AUTHORED_SKY).toContain("float floorY = lat + 0.12;");
  });

  it("lights the wall before any frame arrives (sanity)", async () => {
    const r = await smokeRenderPluginSky(wrappedSky(rawSky), new Float32Array(VIZ_UBO.totalFloats), HOST_DEFAULTS);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("lights the wall on a host idle-fixture frame through the pack's onFrame (sanity)", async () => {
    const out = runPack(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    const r = await smokeRenderPluginSky(wrappedSky(rawSky), out.slots, out.uniforms);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("line ~140: frames the floor grid as the authored world dome did at 55 degrees", async () => {
    const out = runPack(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    // The authored floor fills the whole look-down view; on the level ray it is only a band at the bottom.
    const cover = await layerAtDefaultCamera(floorCoverLayer, out);
    expect(cover.authored.litPixelFraction, cover.authored.assertion).toBeGreaterThan(0.9);
    sameLayer(cover.now, cover.authored, "floor coverage");
    // Grid lines at the authored spacing, not the far-field vanishing band crammed into a few rows.
    const ink = await layerAtDefaultCamera(floorLayer, out);
    expect(ink.authored.litPixelFraction, ink.authored.assertion).toBeGreaterThan(0.05);
    sameLayer(ink.now, ink.authored, "floor grid ink");
  }, 60_000);

  it("line ~170: frames the hex circuit traces as the authored world dome did at 55 degrees", async () => {
    const out = runPack(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    const { authored, now } = await layerAtDefaultCamera(tracesLayer, out);
    expect(authored.litPixelFraction, authored.assertion).toBeGreaterThan(0.1);
    expect(now.litPixelFraction, `traces on screen: ${now.assertion}`).toBeGreaterThan(0.1);
    sameLayer(now, authored, "circuit traces");
  }, 60_000);
});
