import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
  hostLookUniforms,
  lanFrames35s,
  LAN_35S_PPS,
  noteRowNumbers,
  talkerFrame35s,
  UXPRO_MAX_DARK,
} from "./pack-sky-lan-frame-test-helper";
import { runPackFrameHandler } from "./viz-pack-host";
import { VIZ_DEMO_PACKS } from "../ui/viz-hud";
import type { Role } from "../core/types";

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
  /** blob-mesh look: theme ice (rim 0x4cc9f0, bg 0x0b141c), skyBright 1.18, skyOpacity 0.96. */
  const APP_LOOK = hostLookUniforms({ skyBright: 1.18, skyOpacity: 0.96, rim: 0x4cc9f0, bg: 0x0b141c });
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
    // App camera: lensFov-clamped 64 x 42.7 degrees at 1280 x 800; QE samples the app's scene region.
    const frag = wrappedSky(rawSky, parentedSkyRay("blob-mesh", rawSky, HOST_DEFAULT_PITCH_DEG), appLensSkySpan());
    const r = await smokeRenderPluginSky(frag, slots, APP_LOOK, { keepLuma: true, pngPath: pluginSkySmokePngPath("blob-mesh-prod-lan-35s") });
    const five = fivePatchSummary(appFivePatches(r.luma!));
    const why = `app-region ${five.text}; canvas ${fivePatchSummary(r.qePatches).text}; ${r.assertion} blobs=${Array.from(slots.slice(0, 28)).map((v) => v.toFixed(2)).join(",")}`;
    noteRowNumbers("blob-mesh prod LAN 35s", why);
    expect(five.dark, why).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    expect(() => assertPluginSkySmokeDraws(r), why).not.toThrow();
    // Readable metaballs, not one flat iso: QE flagged the black wall "uniform" at 19/18/18/22/20,
    // and the 6b172413 pack writer's rate / 60 radii (every talker > 17 pkt/s at 0.44) fill the
    // dome at 212/208/212/211/211. A full-iso blob is authored at ~210 luma (rim * uBright 1.18),
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

/**
 * Coverage budget (pod decision, fixed by the pod lead): the blobs may light at most 35% of
 * the tile. "Lit" = luma above the sky background (uBg * 0.12 * uBright, ~0 luma) + 10, over
 * the whole 128 px host-camera draw. Every talker keeps a minimum blob (the shader floor,
 * rad = max(0.16, b.z)); when the minimums alone exceed the budget, the minimum wins.
 * Same production path as above: talker frame from mainVizBuildFrame -> host case ->
 * SwiftShader at the app lens span with the look uniforms, QE's app-region patches.
 */
describe("blob-mesh coverage budget on the app's production path (35% of the tile)", () => {
  const APP_LOOK = hostLookUniforms({ skyBright: 1.18, skyOpacity: 0.96, rim: 0x4cc9f0, bg: 0x0b141c });
  const SLOT = VIZ_UBO.slotFloats;
  const LIT_BUDGET = 0.35;
  const R_MIN = 0.16;
  const BG_LUMA = 255 * (0.2126 * APP_LOOK.uBg[0] + 0.7152 * APP_LOOK.uBg[1] + 0.0722 * APP_LOOK.uBg[2]) * 0.12 * APP_LOOK.uBright;
  const LAN: [string, Role][] = [
    ["172.30.0.10", "self"], ["172.30.0.1", "gateway"], ["172.30.0.21", "lan"], ["172.30.0.22", "lan"],
    ["172.30.0.23", "lan"], ["142.250.66.14", "internet"], ["104.18.32.7", "internet"],
  ];
  const ray = () => parentedSkyRay("blob-mesh", rawSky, HOST_DEFAULT_PITCH_DEG);
  const frag = () => wrappedSky(rawSky, ray(), appLensSkySpan());

  function hostSlots(frame: VizDataFrame): Float32Array {
    const slots = new Float32Array(VIZ_UBO.totalFloats);
    runPackFrameHandler("blob-mesh", frame, {
      writeBuffer: (slot, data) => { slots.fill(0, slot * SLOT, (slot + 1) * SLOT); slots.set(data, slot * SLOT); },
      writeUniform: () => {},
      writeParticles: () => {},
    });
    return slots;
  }

  async function wall(name: string, frame: VizDataFrame, slots = hostSlots(frame)) {
    const r = await smokeRenderPluginSky(frag(), slots, APP_LOOK, { keepLuma: true, pngPath: pluginSkySmokePngPath(name) });
    const five = fivePatchSummary(appFivePatches(r.luma!));
    const lit = r.luma!.filter((v) => v > BG_LUMA + 10).length / r.luma!.length;
    const spread = Math.max(...five.lums) - Math.min(...five.lums);
    const radii = Array.from({ length: frame.talkers.length }, (_, i) => slots[i * 4 + 2]!);
    const r2 = radii.reduce((a, v) => a + Math.max(R_MIN, v) ** 2, 0) + (8 - radii.length) * R_MIN * R_MIN;
    const why = `${five.text} spread ${spread}; lit ${lit.toFixed(3)} (luma > ${(BG_LUMA + 10).toFixed(1)}); slot sum r^2 ${r2.toFixed(3)}; radii ${radii.map((v) => v.toFixed(3)).join(",")}`;
    noteRowNumbers(name, why);
    return { r, five, lit, spread, radii, why };
  }

  function expectNotWallNotBlack(w: Awaited<ReturnType<typeof wall>>): void {
    expect(w.five.dark, `black: ${w.why}`).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    const allBright = w.five.lums.every((l) => l > 200);
    expect(allBright && w.spread < 30, `uniform wall: ${w.why}`).toBe(false);
    expect(w.spread, `uniform: ${w.why}`).toBeGreaterThanOrEqual(30);
    expect(Math.max(...w.five.lums), `white: ${w.why}`).toBeLessThan(240);
  }

  it("7 equal talkers at 60 pkt/s (420 total): not a wall, not black, lit fraction within the budget", async () => {
    const frame = talkerFrame35s(LAN.map(([ip, role]) => ({ ip, role, pps: 60 })), { fixture: "host" }, 2);
    expect(frame.talkers).toHaveLength(7);
    const w = await wall("blob-budget-equal7", frame);
    expectNotWallNotBlack(w);
    expect(w.lit, `over the 35% budget: ${w.why}`).toBeLessThanOrEqual(LIT_BUDGET);
  }, 60_000);

  it("a single talker: not black, lit fraction within the budget", async () => {
    const frame = talkerFrame35s([{ ip: "172.30.0.10", role: "self", pps: 300 }], { fixture: "host" }, 2);
    const w = await wall("blob-budget-single", frame);
    expect(w.five.dark, `black: ${w.why}`).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    expect(w.lit, `over the 35% budget: ${w.why}`).toBeLessThanOrEqual(LIT_BUDGET);
  }, 60_000);

  it("1 busy (400 pkt/s) + 6 at 1 pkt/s: all 7 blobs present at >= the minimum, each small one visible", async () => {
    const frame = talkerFrame35s(LAN.map(([ip, role], i) => ({ ip, role, pps: i === 0 ? 400 : 1 })), { fixture: "host" }, 2);
    expect(frame.talkers).toHaveLength(7);
    const slots = hostSlots(frame);
    const w = await wall("blob-budget-busy1-idle6", frame, slots);
    expect(w.five.dark, `black: ${w.why}`).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    for (let i = 0; i < 7; i++) {
      expect(Math.hypot(slots[i * 4]!, slots[i * 4 + 1]!), `slot ${i} placed (not an idle orbit)`).toBeGreaterThan(0.02);
      expect(slots[i * 4 + 2]!, `slot ${i} radius >= minimum: ${w.why}`).toBeGreaterThanOrEqual(R_MIN - 1e-6);
    }
    // Render check at each small blob's projected centre: with the blob vs the same blob moved off-view.
    const small = frame.talkers.map((t, i) => ({ t, i })).filter(({ t }) => t.rate < 10);
    expect(small).toHaveLength(6);
    const centres = projectBlobCentres(slots, ray(), appLensSkySpan());
    let inView = 0;
    const notes: string[] = [];
    for (const { i } of small) {
      const c = centres[i]!;
      if (!c.inView) { notes.push(`slot ${i} off-view`); continue; }
      inView++;
      const away = new Float32Array(slots);
      away[i * 4] = 3; away[i * 4 + 1] = 3;
      const r0 = await smokeRenderPluginSky(frag(), away, APP_LOOK, { keepLuma: true });
      const here = w.r.luma![c.idx]!;
      const gone = r0.luma![c.idx]!;
      notes.push(`slot ${i} centre px(${c.px},${c.py}) luma ${here.toFixed(0)} vs ${gone.toFixed(0)} without it`);
      expect(here - gone, `small blob ${i} not visible at its centre: ${notes.join("; ")}`).toBeGreaterThanOrEqual(10);
    }
    noteRowNumbers("blob-budget-busy1-idle6 centres", notes.join("; "));
    expect(inView, `small blobs in view: ${notes.join("; ")}`).toBeGreaterThan(0);
  }, 120_000);

  it("the live 7-device 420 pkt/s LAN: lit fraction within the budget", async () => {
    const [frame] = lanFrames35s({ fixture: "host" }, 2);
    const w = await wall("blob-budget-lan7", frame!);
    expectNotWallNotBlack(w);
    expect(w.lit, `over the 35% budget: ${w.why}`).toBeLessThanOrEqual(LIT_BUDGET);
  }, 60_000);
});

/**
 * Where each slot's blob centre lands in the 128 px host-camera draw: the sky's own ray
 * mapping (atHostCamera span + ray, then the 45 degree tilt and dome uv) run per pixel.
 */
function projectBlobCentres(slots: Float32Array, ray: SkyRay, span: SkySpan): { px: number; py: number; idx: number; inView: boolean }[] {
  const N = 128;
  const uvs: [number, number][] = new Array(N * N);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const nx = ((px + 0.5) / N) * 2 - 1;
      const ny = ((py + 0.5) / N) * 2 - 1; // readPixels row 0 = bottom
      let v = [nx, ny, -1];
      const l0 = Math.hypot(v[0]!, v[1]!, v[2]!);
      v = v.map((c) => c / l0);
      const s3 = [v[0]! * span[0], v[1]! * span[1], v[2]!];
      const m = ray; // column-major mat3
      let c = [
        m[0]! * s3[0]! + m[3]! * s3[1]! + m[6]! * s3[2]!,
        m[1]! * s3[0]! + m[4]! * s3[1]! + m[7]! * s3[2]!,
        m[2]! * s3[0]! + m[5]! * s3[1]! + m[8]! * s3[2]!,
      ];
      const l1 = Math.hypot(c[0]!, c[1]!, c[2]!);
      c = c.map((x) => x / l1);
      let d = [c[0]!, 0.70710678 * (c[1]! + c[2]!), 0.70710678 * (c[2]! - c[1]!)];
      const l2 = Math.hypot(d[0]!, d[1]!, d[2]!);
      d = d.map((x) => x / l2);
      const k = 0.35 + Math.abs(d[1]!);
      uvs[py * N + px] = [d[0]! / k, d[2]! / k];
    }
  }
  const out: { px: number; py: number; idx: number; inView: boolean }[] = [];
  for (let i = 0; i < 8; i++) {
    const pos = [slots[i * 4]! * 1.7, slots[i * 4 + 1]! * 1.7];
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < uvs.length; j++) {
      const dd = Math.hypot(uvs[j]![0] - pos[0]!, uvs[j]![1] - pos[1]!);
      if (dd < bestD) { bestD = dd; best = j; }
    }
    const px = best % N;
    const py = Math.floor(best / N);
    out.push({ px, py: N - 1 - py, idx: best, inView: bestD < 0.03 && px > 0 && px < N - 1 && py > 0 && py < N - 1 });
  }
  return out;
}
