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
 * Roto Proto (authored 2026-09-18, before 2f44932a parented plugin skies to the camera)
 * maps vDir as a world dome, `dir.xz / max(0.22, |dir.y|)`. On today's camera-local ray
 * the view looks down -z, so half the screen sits in the |dir.y| < 0.22 clamp band
 * (vertical smear) and the vignette centre is off screen. It still draws something,
 * so the lit rows are sanity rows; the authored-framing row is the regression guard.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rawSky = readFileSync(path.resolve(here, "../../../plugins/src/roto-proto/sky/fragment.glsl"), "utf8");

/** The authored (20fa18a7) sky: the fix's camera-to-dome tilt folded back to a plain vDir read. */
const AUTHORED_SKY = rawSky.replace(
  /vec3 cam = normalize\(vDir\);\s*vec3 dir = normalize\(vec3\(cam\.x,[^;]*;/,
  "vec3 dir = normalize(vDir);",
);

/** Plugin sky uniforms before any pack write (acid theme, roto-proto look skyBright 1.2). */
const HOST_DEFAULTS: PluginSkySmokeUniforms = {
  uTime: 3,
  uOpacity: 0.96,
  uBright: 1.2,
  uAudio: 0,
  uAccent: [0xc8 / 255, 0xff / 255, 0x00 / 255],
  uBg: [0x0c / 255, 0x10 / 255, 0x06 / 255],
};

function wrappedSky(src = rawSky, ray: SkyRay = IDENTITY_SKY_RAY): string {
  const w = wrapPluginSky(atHostCamera(src, ray));
  if ("error" in w) throw new Error(w.error);
  return w.frag;
}

type PackOut = { slots: Float32Array; uniforms: PluginSkySmokeUniforms };

let onFrame: ((frame: VizDataFrame) => void) | null = null;
let slot0: number[] = [];
let written: Record<string, number | [number, number, number]> = {};

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    writeBuffer: (slot: number, data: number[] | Float32Array) => {
      if (slot === 0) slot0 = Array.from(data);
    },
    writeUniform: (name: string, value: number | [number, number, number]) => {
      written[name] = value;
    },
    writeParticles: () => {},
  };
  await import("../../../plugins/src/roto-proto/frontend/index");
  onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
});

afterAll(async () => {
  delete (globalThis as { zoto?: unknown }).zoto;
  await closePluginSkySmokeBrowser();
});

const EMPTY: VizDataFrame = { t: 3, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

function runPack(frame: VizDataFrame): PackOut {
  expect(onFrame, "roto-proto frontend registers host.onFrame").toBeTypeOf("function");
  slot0 = [];
  written = {};
  onFrame!(frame);
  expect(slot0.length).toBeGreaterThan(0);
  const slots = new Float32Array(VIZ_UBO.totalFloats);
  slots.set(slot0);
  const u = written;
  return {
    slots,
    uniforms: {
      ...HOST_DEFAULTS,
      uBright: typeof u.uBright === "number" ? u.uBright : HOST_DEFAULTS.uBright,
      uAudio: typeof u.uAudio === "number" ? u.uAudio : 0,
      uAccent: Array.isArray(u.uAccent) ? u.uAccent : HOST_DEFAULTS.uAccent,
    },
  };
}

function sameLook(a: PluginSkySmokeResult, b: PluginSkySmokeResult, label: string): void {
  expect(Math.abs(a.medianLuma - b.medianLuma), `${label}: ${a.assertion} vs ${b.assertion}`).toBeLessThan(0.004);
  expect(Math.abs(a.litPixelFraction - b.litPixelFraction), `${label}: ${a.assertion} vs ${b.assertion}`).toBeLessThan(0.01);
}

const QUIET: VizDataFrame = { ...EMPTY, packets: [{ proto: "tcp", size: 80, field: 0.05 }], talkers: [{ id: "10.0.0.2", rate: 0.5, role: "lan" }] };

describe("roto-proto sky on the host camera", () => {
  it("lights the wall before any frame arrives (sanity: the old mapping also lights it)", async () => {
    const r = await smokeRenderPluginSky(wrappedSky(), new Float32Array(VIZ_UBO.totalFloats), HOST_DEFAULTS);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("lights the wall on quiet traffic through the pack's onFrame (sanity)", async () => {
    const out = runPack(QUIET);
    const r = await smokeRenderPluginSky(wrappedSky(), out.slots, out.uniforms);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("lights the wall on a host idle-fixture frame through the pack's onFrame (sanity)", async () => {
    const out = runPack(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    const r = await smokeRenderPluginSky(wrappedSky(), out.slots, out.uniforms);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("frames the rotozoom plane as the authored world dome did at the default graph camera", async () => {
    const out = runPack(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    const authored = await smokeRenderPluginSky(
      wrappedSky(AUTHORED_SKY, worldDomeSkyRay(HOST_DEFAULT_PITCH_DEG)), out.slots, out.uniforms);
    const now = await smokeRenderPluginSky(
      wrappedSky(rawSky, parentedSkyRay("roto-proto", rawSky, HOST_DEFAULT_PITCH_DEG)), out.slots, out.uniforms);
    sameLook(now, authored, "camera-parented now vs authored world dome");
  }, 60_000);

  it("looks the same when the graph camera orbits to 15 and 75 degrees (sky parented via syncCamera)", async () => {
    const out = runPack(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    const at = (pitch: number) => smokeRenderPluginSky(
      wrappedSky(rawSky, parentedSkyRay("roto-proto", rawSky, pitch)), out.slots, out.uniforms);
    const base = await at(HOST_DEFAULT_PITCH_DEG);
    for (const pitch of [15, 75]) {
      const r = await at(pitch);
      expect(() => assertPluginSkySmokeDraws(r), `pitch ${pitch}: ${r.assertion}`).not.toThrow();
      sameLook(r, base, `pitch ${pitch} vs 45`);
    }
    const w15 = await smokeRenderPluginSky(wrappedSky(rawSky, worldDomeSkyRay(15)), out.slots, out.uniforms);
    const w75 = await smokeRenderPluginSky(wrappedSky(rawSky, worldDomeSkyRay(75)), out.slots, out.uniforms);
    expect(w15.pixelChecksum, "world-fixed dome control should differ across pitch").not.toBe(w75.pixelChecksum);
  }, 90_000);
});
