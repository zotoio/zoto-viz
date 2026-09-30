import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wrapPluginSky } from "./plugin-sky-probe";
import {
  assertPluginSkySmokeDraws,
  closePluginSkySmokeBrowser,
  PLUGIN_SKY_SMOKE_CLEAR,
  pluginSkySmokePngPath,
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
  appLensSkySpan,
  type SkyRay,
  type SkySpan,
} from "./pack-sky-host-camera-test-helper";
import {
  appFivePatches,
  fivePatchSummary,
  lanFrames35s,
  LAN_35S_PPS,
  noteRowNumbers,
  UXPRO_MAX_DARK,
} from "./pack-sky-lan-frame-test-helper";
import { runPackFrameHandler } from "./viz-pack-host";
import { blobMeshLookNumber, blobMeshPackLook, blobMeshPackWrites } from "./blob-mesh-look-test-helper";
import { VIZ_DEMO_PACKS } from "../ui/viz-hud";

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

function wrappedSky(src = rawSky, ray: SkyRay = IDENTITY_SKY_RAY, span?: SkySpan): string {
  const w = wrapPluginSky(atHostCamera(src, ray, span));
  if ("error" in w) throw new Error(w.error);
  return w.frag;
}

/** Plugin sky material defaults before any pack write (backdrop.ts pluginUniforms / blob-mesh look from visualisation.yml). */
const HOST_DEFAULTS: PluginSkySmokeUniforms = {
  uTime: 3,
  uOpacity: blobMeshLookNumber("skyOpacity"),
  uBright: blobMeshLookNumber("skyBright"),
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

/**
 * The pack frontend's writes for `frame`, drawn the way the app draws them (#180 H1, #188): the
 * pack's uBright / uOpacity multiply the host look's (visualisation.yml skyBright / skyOpacity);
 * its uAudio / uAccent win. `packBright` is the pack's raw uBright write (1 when it writes none).
 */
function packWriterInputs(frame: VizDataFrame): { slots: Float32Array; uniforms: PluginSkySmokeUniforms; packBright: number } {
  expect(onFrame, "blob-mesh frontend registers host.onFrame").toBeTypeOf("function");
  expect(frame.talkers.length).toBeGreaterThan(0);
  onFrame!(frame);
  expect(captured.slot0.length).toBeGreaterThan(0);
  const slots = new Float32Array(VIZ_UBO.totalFloats);
  slots.set(captured.slot0);
  const u = captured.uniforms;
  const packBright = typeof u.uBright === "number" ? u.uBright : 1;
  return {
    slots,
    packBright,
    uniforms: {
      ...HOST_DEFAULTS,
      uBright: HOST_DEFAULTS.uBright * packBright,
      uOpacity: HOST_DEFAULTS.uOpacity * (typeof u.uOpacity === "number" ? u.uOpacity : 1),
      uAudio: typeof u.uAudio === "number" ? u.uAudio : 0,
      uAccent: Array.isArray(u.uAccent) ? u.uAccent : HOST_DEFAULTS.uAccent,
    },
  };
}

const EMPTY: VizDataFrame = { t: 3, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

describe("blob-mesh sky draws on the host camera", () => {
  it("lights the wall before any frame arrives (empty slots, host look uniforms)", async () => {
    const r = await smokeRenderPluginSky(wrappedSky(), new Float32Array(VIZ_UBO.totalFloats), HOST_DEFAULTS);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

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

/**
 * #161: Blob Mesh black in the real app (UX Pro headed run at 6b172413, 35 s after pick,
 * header 7 devices / 420 pkt/s: five-patch lumas 19/18/18/22/20, only the floor grid).
 *
 * Production path: blob-mesh is in VIZ_DEMO_PACKS, so viz-present-deliver.ts (packId at :69)
 * hands every delivered frame to deliverVizPluginFrame (viz-frame-tick.ts), which posts it to
 * the pack's sandboxed frontend (:29, async over a MessagePort) and then synchronously runs
 * the host mirror runPackFrameHandler("blob-mesh") (:39), marking the tile "host-direct"
 * (viz-present-deliver.ts:113). That runs inside the present listener fired by markFrame
 * (scene.ts:4085), before applyLook (:4136) and the draw, so the host case's slot-0 blobs are
 * what gets drawn; the sandbox reply lands between frames and is overwritten on the next
 * deliver. The earlier rows drove only the pack frontend writer, never this case.
 */
describe("blob-mesh on the app's production path (host runPackFrameHandler, live LAN)", () => {
  /**
   * The uniforms the app draws blob-mesh with (#180 H1): visualisation.yml skyBright / skyOpacity and
   * its theme's bg, times the pack's own uBright, with the pack's uAudio / uAccent.
   */
  const appLookFor = (frame: VizDataFrame): PluginSkySmokeUniforms => blobMeshPackLook(frame).u;
  const SLOT = VIZ_UBO.slotFloats;

  function hostCaseSlots(frame: VizDataFrame): Float32Array {
    const slots = new Float32Array(VIZ_UBO.totalFloats);
    runPackFrameHandler("blob-mesh", frame, {
      // VizBufferWriter.writeBuffer: copy, zero the rest of the slot.
      writeBuffer: (slot, data) => {
        slots.fill(0, slot * SLOT, (slot + 1) * SLOT);
        slots.set(data, slot * SLOT);
      },
      writeUniform: () => {},
      writeParticles: () => {},
    });
    return slots;
  }

  it("is the host mirror, not only the pack frontend, that feeds the app's blob-mesh slots", () => {
    expect(VIZ_DEMO_PACKS).toContain("blob-mesh");
    const [frame] = lanFrames35s({ fixture: "host" }, 2);
    expect(frame!.talkers).toHaveLength(7);
    expect(frame!.talkers.reduce((s, t) => s + t.rate, 0)).toBe(LAN_35S_PPS);
    const slots = hostCaseSlots(frame!);
    expect(slots.slice(0, 28).some((v) => v !== 0), "host case writes the 7 talker blobs").toBe(true);
  });

  it("lights the wall for a 7-talker 420 pkt/s LAN at the host camera (UX Pro five-patch rule)", async () => {
    const [frame] = lanFrames35s({ fixture: "host" }, 2);
    const slots = hostCaseSlots(frame!);
    // The look is the pack's: yml skyBright x the uBright the pack writes for this frame (no copy of either here).
    const look = appLookFor(frame!);
    const packBright = blobMeshPackWrites(frame!).uBright;
    const skyBright = blobMeshLookNumber("skyBright");
    expect(typeof packBright, "the pack writes uBright").toBe("number");
    expect(look.uBright, `rendered uBright ${look.uBright} vs visualisation.yml skyBright ${skyBright} x pack uBright ${String(packBright)}`)
      .toBeCloseTo(skyBright * (packBright as number), 9);
    // App camera: lensFov-clamped 64 x 42.7 degrees at 1280 x 800; QE samples the app's scene region.
    const frag = wrappedSky(rawSky, parentedSkyRay("blob-mesh", rawSky, HOST_DEFAULT_PITCH_DEG), appLensSkySpan());
    const r = await smokeRenderPluginSky(frag, slots, look, { keepLuma: true, pngPath: pluginSkySmokePngPath("blob-mesh-prod-lan-35s") });
    const five = fivePatchSummary(appFivePatches(r.luma!));
    const why = `uBright=${look.uBright.toFixed(3)} app-region ${five.text}; canvas ${fivePatchSummary(r.qePatches).text}; ${r.assertion} blobs=${Array.from(slots.slice(0, 28)).map((v) => v.toFixed(2)).join(",")}`;
    noteRowNumbers("blob-mesh prod LAN 35s", why);
    expect(five.dark, why).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    expect(() => assertPluginSkySmokeDraws(r), why).not.toThrow();
    // Readable metaballs, not one flat iso: QE flagged the black wall "uniform" at 19/18/18/22/20,
    // and the 6b172413 pack writer's rate / 60 radii (every talker > 17 pkt/s at 0.44) fill the
    // dome at 212/208/212/211/211. A full-iso blob tops out near ~215 luma (teal tint clamps),
    // so the cap is white, not 200.
    expect(Math.max(...five.lums) - Math.min(...five.lums), `not a uniform wall: ${why}`).toBeGreaterThanOrEqual(30);
    expect(Math.max(...five.lums), `not white: ${why}`).toBeLessThan(240);
  }, 60_000);

  it("writes the same slots and uBright as the pack's own frontend on live, idle and quiet frames", () => {
    const quiet = { ...EMPTY, t: 35, talkers: ["gateway", "lan", "internet"].map((role, i) => ({ id: `192.168.1.${10 + i}`, rate: 0.5, role })) };
    const frames = [...lanFrames35s({ fixture: "host" }, 2, 3), mergeVizIdleFrame({ ...EMPTY, t: 35 }, { fixture: "host" }), quiet];
    for (const frame of frames) {
      const { slots, packBright } = packWriterInputs(frame);
      captured = { slot0: [], uniforms: {} };
      let hostBright: number | null = null;
      const host = new Float32Array(VIZ_UBO.totalFloats);
      runPackFrameHandler("blob-mesh", frame, {
        writeBuffer: (slot, data) => host.set(data, slot * SLOT),
        writeUniform: (name, value) => { if (name === "uBright" && typeof value === "number") hostBright = value; },
        writeParticles: () => {},
      });
      expect(Array.from(host.slice(0, 32)), `t=${frame.t} talkers=${frame.talkers.length}`).toEqual(Array.from(slots.slice(0, 32)));
      expect(hostBright).toBe(packBright);
    }
  });

  /**
   * #188 item 2: the pack-writer rows draw the uBright the app renders, host look x pack write
   * (blobMeshPackLook, the #180 H1 rule), not the pack's raw write the app would overwrite.
   * Revert: packWriterInputs back to the pack's uBright alone -> red on every frame.
   */
  it("pack-writer rows draw the app's uBright: visualisation.yml skyBright x the pack's write, on live, idle and quiet frames", () => {
    const quiet = { ...EMPTY, t: 35, talkers: ["gateway", "lan", "internet"].map((role, i) => ({ id: `192.168.1.${10 + i}`, rate: 0.5, role })) };
    const frames = [...lanFrames35s({ fixture: "host" }, 2, 3), mergeVizIdleFrame({ ...EMPTY, t: 35 }, { fixture: "host" }), quiet, { ...quiet, audio: 1 }];
    const skyBright = blobMeshLookNumber("skyBright");
    for (const frame of frames) {
      const { uniforms, packBright } = packWriterInputs(frame);
      captured = { slot0: [], uniforms: {} };
      const app = appLookFor(frame);
      const why = `t=${frame.t} audio=${frame.audio} talkers=${frame.talkers.length}: harness uBright ${uniforms.uBright} vs app ${app.uBright} (skyBright ${skyBright} x pack ${packBright})`;
      expect(uniforms.uBright, why).toBeCloseTo(app.uBright, 9);
      expect(uniforms.uBright, why).toBeCloseTo(skyBright * packBright, 9);
      expect(uniforms.uOpacity, why).toBeCloseTo(app.uOpacity, 9);
    }
  });

  /**
   * #188 item 1 on Blob's own frame: at the app's skyOpacity (< 1) the harness output is the
   * opaque draw composited over its clear, pixel by pixel (+-1 luma), so an opacity regression
   * shows in Blob's frame rows. Revert: the harness without its blend -> red.
   */
  it("the live-LAN frame at the app's skyOpacity is the opaque draw composited over the clear (harness honours uOpacity)", async () => {
    const [frame] = lanFrames35s({ fixture: "host" }, 2);
    const slots = hostCaseSlots(frame!);
    const look = appLookFor(frame!);
    expect(look.uOpacity, "blob-mesh draws below full opacity").toBeLessThan(1);
    const frag = wrappedSky(rawSky, parentedSkyRay("blob-mesh", rawSky, HOST_DEFAULT_PITCH_DEG), appLensSkySpan());
    const seen = await smokeRenderPluginSky(frag, slots, look, { keepLuma: true });
    const opaque = await smokeRenderPluginSky(frag, slots, { ...look, uOpacity: 1 }, { keepLuma: true });
    const c = PLUGIN_SKY_SMOKE_CLEAR;
    const clearLuma = 0.2126 * Math.round(255 * c[0]) + 0.7152 * Math.round(255 * c[1]) + 0.0722 * Math.round(255 * c[2]);
    const errs = seen.luma!.map((v, i) => Math.abs(v - (opaque.luma![i]! * look.uOpacity + clearLuma * (1 - look.uOpacity))));
    const worst = Math.max(...errs);
    const why = `uOpacity ${look.uOpacity}: worst pixel off the composite by ${worst.toFixed(2)} luma; checksums ${seen.pixelChecksum} vs opaque ${opaque.pixelChecksum}`;
    process.stdout.write(`[blob-opacity] ${why}\n`);
    expect(seen.pixelChecksum, why).not.toBe(opaque.pixelChecksum);
    expect(worst, why).toBeLessThanOrEqual(1.5);
  }, 60_000);
});
