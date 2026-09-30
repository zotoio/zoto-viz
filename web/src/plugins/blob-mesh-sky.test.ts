import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShaderMaterial } from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Backdrop } from "../graph/backdrop";
import { wrapPluginSky } from "./plugin-sky-probe";
import {
  assertPluginSkySmokeDraws,
  closePluginSkySmokeBrowser,
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

/**
 * #188: the uniforms the app draws for the pack writer's frame. packWriterInputs above keeps the
 * pack's raw writes (the #161 writer-parity row compares those); this is what reaches the wall.
 * #180 H1 makes the pack's uBright / uOpacity factors on the host look: backdrop.ts
 * setPluginUniform (:1472) and syncPluginLook (:1509) put host uBright x pack uBright on the
 * material, and applyMorphFade (:1621) host opacity x pack uOpacity (blob-mesh writes none: 1).
 * The host look is visualisation.yml skyBright / skyOpacity: scene.ts applyLook (:2651-2665) hands
 * a `backdrop: plugin` view setLook(skyOpacity, skyBright x thermalSkyK x visScale), both factors 1
 * by default. The pack's uBright is 0.8 + 0.2 x audio (frontend/index.ts:16), so the drawn uBright
 * is skyBright x (0.8 + 0.2 x audio), never the pack's value alone.
 */
function packWriterDrawInputs(frame: VizDataFrame): { slots: Float32Array; uniforms: PluginSkySmokeUniforms; packBright: number } {
  const { slots, uniforms } = packWriterInputs(frame);
  const w = captured.uniforms;
  const packBright = typeof w.uBright === "number" ? w.uBright : 1;
  const packOpacity = typeof w.uOpacity === "number" ? w.uOpacity : 1;
  return {
    slots,
    packBright,
    uniforms: { ...uniforms, uBright: HOST_DEFAULTS.uBright * packBright, uOpacity: HOST_DEFAULTS.uOpacity * packOpacity },
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
    const { slots, uniforms } = packWriterDrawInputs({ ...EMPTY, talkers });
    const r = await smokeRenderPluginSky(wrappedSky(), slots, uniforms);
    expect(() => assertPluginSkySmokeDraws(r), r.assertion).not.toThrow();
  }, 60_000);

  it("lights the wall from the pack's own writer on a host idle-fixture frame", async () => {
    const { slots, uniforms } = packWriterDrawInputs(mergeVizIdleFrame(EMPTY, { fixture: "host" }));
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
 * #188: the pack-writer rows render what the app's Backdrop puts on the material, not the pack's
 * own uBright. The expected numbers come from the real path (see packWriterDrawInputs): host
 * skyBright 1.03 / skyOpacity 0.96 (visualisation.yml) x pack uBright 0.8 + 0.2 x audio.
 * Revert: render the pack's uBright alone in packWriterDrawInputs -> 0.8 vs 0.824, red.
 */
describe("blob-mesh pack-writer rows draw the app's host x pack uBright (#188, #180 H1)", () => {
  /** A real Backdrop at blob-mesh's host look, with the pack's writes forwarded (NetScene.setPluginUniform's route). */
  function backdropDraws(writes: Record<string, number | [number, number, number]>): { bright: number; opacity: number } {
    const b = new Backdrop();
    b.setKind("plugin");
    expect(b.setPluginShader({ id: "blob-mesh", source: rawSky }, () => null)).toBeNull();
    for (let f = 0; f <= 240; f++) {
      b.setLook(HOST_DEFAULTS.uOpacity, HOST_DEFAULTS.uBright, 0);
      for (const [name, v] of Object.entries(writes)) expect(b.setPluginUniform(name, v), name).toBe(true);
      b.tick(f / 60);
    }
    expect(b.skyMorphing(), "crossfade done").toBe(false);
    const m = b.mesh.material;
    if (!(m instanceof ShaderMaterial)) throw new Error("the plugin sky material is not on the sphere");
    const bright: unknown = m.uniforms.uBright?.value;
    const opacity: unknown = m.uniforms.uOpacity?.value;
    if (typeof bright !== "number" || typeof opacity !== "number") throw new Error("plugin material has no uBright / uOpacity");
    return { bright, opacity };
  }

  it("renders skyBright x (0.8 + 0.2 x audio) and skyOpacity, the values the Backdrop draws: 0.824 / 0.927 / 1.03 and 0.96", () => {
    const idle = mergeVizIdleFrame({ ...EMPTY, t: 35 }, { fixture: "host" });
    const pinned = [
      { audio: 0, pack: 0.8, drawn: 0.824 },
      { audio: 0.5, pack: 0.9, drawn: 0.927 },
      { audio: 1, pack: 1, drawn: 1.03 },
    ];
    for (const p of pinned) {
      const frame = { ...idle, audio: p.audio };
      const { uniforms, packBright } = packWriterDrawInputs(frame);
      const writes = { ...captured.uniforms };
      captured = { slot0: [], uniforms: {} };
      const app = backdropDraws(writes);
      const why = `audio ${p.audio}: pack uBright ${packBright}, Backdrop draws uBright ${app.bright} uOpacity ${app.opacity}; harness uBright ${uniforms.uBright} uOpacity ${uniforms.uOpacity}`;
      expect(packBright, why).toBeCloseTo(p.pack, 9);
      expect(app.bright, why).toBeCloseTo(p.drawn, 9);
      expect(app.opacity, why).toBeCloseTo(0.96, 9);
      expect(uniforms.uBright, `harness renders the Backdrop's uBright: ${why}`).toBeCloseTo(app.bright, 9);
      expect(uniforms.uOpacity, `harness renders the Backdrop's uOpacity: ${why}`).toBeCloseTo(app.opacity, 9);
      expect(Math.abs(app.bright - packBright), `the host factor is visible: ${why}`).toBeGreaterThan(0.01);
    }
  });
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
      const { slots, uniforms } = packWriterInputs(frame);
      captured = { slot0: [], uniforms: {} };
      let hostBright: number | null = null;
      const host = new Float32Array(VIZ_UBO.totalFloats);
      runPackFrameHandler("blob-mesh", frame, {
        writeBuffer: (slot, data) => host.set(data, slot * SLOT),
        writeUniform: (name, value) => { if (name === "uBright" && typeof value === "number") hostBright = value; },
        writeParticles: () => {},
      });
      expect(Array.from(host.slice(0, 32)), `t=${frame.t} talkers=${frame.talkers.length}`).toEqual(Array.from(slots.slice(0, 32)));
      expect(hostBright).toBe(uniforms.uBright);
    }
  });
});
