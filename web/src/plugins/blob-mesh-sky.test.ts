import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wrapPluginSky } from "./plugin-sky-probe";
import {
  assertPluginSkySmokeDraws,
  closePluginSkySmokeBrowser,
  smokeRenderPluginSky,
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
 * Blob Mesh wall black (QE pick-every-view on 20fa18a7, row 29): the host parents
 * plugin skies to the camera, so vDir is a camera-local ray looking down -z. The
 * sky's dome projection (dir.xz / |dir.y|) then lands |uv| >= ~1.2 across the whole
 * view while the blobs live inside |uv| <= ~1.1, so the wall stays ~uBg * 0.12.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packHome = path.resolve(here, "../../../plugins/src/blob-mesh");
const rawSky = readFileSync(path.join(packHome, "sky/fragment.glsl"), "utf8");

/** The authored (20fa18a7) sky: the fix's camera-to-dome tilt folded back to a plain vDir read. */
const AUTHORED_SKY = rawSky.replace(
  /vec3 cam = normalize\(vDir\);\s*vec3 dir = normalize\(vec3\(cam\.x,[^;]*;/,
  "vec3 dir = normalize(vDir);",
);

function wrappedSky(src = rawSky, ray: SkyRay = IDENTITY_SKY_RAY): string {
  const w = wrapPluginSky(atHostCamera(src, ray));
  if ("error" in w) throw new Error(w.error);
  return w.frag;
}

/** Plugin sky material defaults before any pack write (backdrop.ts pluginUniforms / blob-mesh look). */
const HOST_DEFAULTS: PluginSkySmokeUniforms = {
  uTime: 3,
  uOpacity: 0.96,
  uBright: 1.18,
  uAudio: 0,
  uAccent: [0x7e / 255, 0xe0 / 255, 0xff / 255],
  uBg: [0x0b / 255, 0x14 / 255, 0x1c / 255],
};

type Captured = { slot0: number[]; uniforms: Record<string, number | [number, number, number]> };

let onFrame: ((frame: VizDataFrame) => void) | null = null;
let captured: Captured = { slot0: [], uniforms: {} };

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    writeBuffer: (slot: number, data: number[] | Float32Array) => {
      if (slot === 0) captured.slot0 = Array.from(data);
    },
    writeUniform: (name: string, value: number | [number, number, number]) => {
      captured.uniforms[name] = value;
    },
    writeParticles: () => {},
  };
  await import("../../../plugins/src/blob-mesh/frontend/index");
  onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
});

afterEach(() => {
  captured = { slot0: [], uniforms: {} };
});

afterAll(async () => {
  delete (globalThis as { zoto?: unknown }).zoto;
  await closePluginSkySmokeBrowser();
});

describe("blob-mesh sky draws on the host camera", () => {
  it("lights the wall before any frame arrives (empty slots, host look uniforms)", async () => {
    const r = await smokeRenderPluginSky(wrappedSky(), new Float32Array(VIZ_UBO.totalFloats), HOST_DEFAULTS);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  function packWriterInputs(frame: VizDataFrame): { slots: Float32Array; uniforms: PluginSkySmokeUniforms } {
    expect(onFrame, "blob-mesh frontend registers host.onFrame").toBeTypeOf("function");
    expect(frame.talkers.length).toBeGreaterThan(0);
    onFrame!(frame);
    expect(captured.slot0.length).toBeGreaterThan(0);
    const slots = new Float32Array(VIZ_UBO.totalFloats);
    slots.set(captured.slot0);
    const u = captured.uniforms;
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

  const EMPTY: VizDataFrame = { t: 3, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

  it("lights the wall on a quiet LAN (live talkers at low rates, smallest blobs)", async () => {
    const roles = ["gateway", "lan", "internet", "lan", "local"];
    const talkers = roles.map((role, i) => ({ id: `192.168.1.${10 + i}`, rate: 0.5, role }));
    const { slots, uniforms } = packWriterInputs({ ...EMPTY, talkers });
    const r = await smokeRenderPluginSky(wrappedSky(), slots, uniforms);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("lights the wall from the pack's own writer on a host idle-fixture frame", async () => {
    const { slots, uniforms } = packWriterInputs(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
    const r = await smokeRenderPluginSky(wrappedSky(), slots, uniforms);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("frames the blobs as the authored world dome did at the default graph camera", async () => {
    // Before 2f44932a the dome sat at the origin, so vDir was the world ray of the
    // graph camera at (0, 820, 820). Now the dome is parented to the camera.
    const empty = new Float32Array(VIZ_UBO.totalFloats);
    const authored = await smokeRenderPluginSky(
      wrappedSky(AUTHORED_SKY, worldDomeSkyRay(HOST_DEFAULT_PITCH_DEG)), empty, HOST_DEFAULTS);
    const now = await smokeRenderPluginSky(
      wrappedSky(rawSky, parentedSkyRay("blob-mesh", rawSky, HOST_DEFAULT_PITCH_DEG)), empty, HOST_DEFAULTS);
    expect(Math.abs(now.medianLuma - authored.medianLuma), `${now.assertion} vs authored ${authored.assertion}`)
      .toBeLessThan(0.004);
    expect(Math.abs(now.litPixelFraction - authored.litPixelFraction), `${now.assertion} vs authored ${authored.assertion}`)
      .toBeLessThan(0.01);
  }, 60_000);

  it("looks the same when the graph camera orbits to 15 and 75 degrees (sky parented via syncCamera)", async () => {
    const empty = new Float32Array(VIZ_UBO.totalFloats);
    const at = (pitch: number) => smokeRenderPluginSky(
      wrappedSky(rawSky, parentedSkyRay("blob-mesh", rawSky, pitch)), empty, HOST_DEFAULTS);
    const base = await at(HOST_DEFAULT_PITCH_DEG);
    expect(() => assertPluginSkySmokeDraws(base), base.assertion).not.toThrow();
    for (const pitch of [15, 75]) {
      const r = await at(pitch);
      expect(() => assertPluginSkySmokeDraws(r), `pitch ${pitch}: ${r.assertion}`).not.toThrow();
      expect(Math.abs(r.medianLuma - base.medianLuma), `pitch ${pitch}: ${r.assertion} vs 45: ${base.assertion}`)
        .toBeLessThan(0.004);
    }
    // Control: an unparented (world-fixed) dome does change with pitch, so the row can see orbit drift.
    const w15 = await smokeRenderPluginSky(wrappedSky(rawSky, worldDomeSkyRay(15)), empty, HOST_DEFAULTS);
    const w75 = await smokeRenderPluginSky(wrappedSky(rawSky, worldDomeSkyRay(75)), empty, HOST_DEFAULTS);
    expect(w15.pixelChecksum, "world-fixed dome control should differ across pitch").not.toBe(w75.pixelChecksum);
  }, 90_000);
});
