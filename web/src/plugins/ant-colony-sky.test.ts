import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wrapPluginSky } from "./plugin-sky-probe";
import {
  closePluginSkySmokeBrowser,
  PLUGIN_SKY_SMOKE_CLEAR,
  pluginSkySmokePngPath,
  smokeRenderPluginSky,
  type PluginSkySmokeResult,
  type PluginSkySmokeUniforms,
} from "./plugin-sky-smoke-render";
import { mergeVizIdleFrame, VIZ_UBO, type VizDataFrame } from "./viz-host";
import {
  atHostCamera,
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
  noteRowNumbers,
  UXPRO_DARK_LUM,
  UXPRO_MAX_DARK,
} from "./pack-sky-lan-frame-test-helper";
import { normalizeVizDemoPackId } from "../ui/viz-hud";
import { markFrame, resetFps } from "../core/fps";
import { notePerfChange, perfOverlay, perfStress, resetPerf, tickPerf, type PerfSrc } from "../core/perf";
import type { FrameTs } from "../core/time-ms";
import { skyLookFor } from "../graph/stage-sky-look";

/**
 * Ant Colony wall black (QE pick-every-view on 20fa18a7, row 27). The pack is
 * `look.stageOnly`, so the host levels the camera (scene.ts setStageOnly) and parents
 * the sky to it (backdrop.ts syncCamera): vDir is a camera-local ray looking down -z.
 * The sky mapped it as a world dome, `dir.xz / (0.42 + 0.35 |dir.y|)`, which puts the
 * whole view at uv.y < 0 below the formicarium (only the edge pheromone cells smear in),
 * and before the first frame it divided by a zero zoom slot.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rawSky = readFileSync(path.resolve(here, "../../../plugins/src/ant-colony/sky/fragment.glsl"), "utf8");

const SLOT = VIZ_UBO.slotFloats;
const META_CHAMBERS = 12;
const META_TUNNELS = 13;

/** Plugin sky uniforms before any pack write (ember theme, ant-colony look skyBright 1.05). */
const HOST_DEFAULTS: PluginSkySmokeUniforms = {
  uTime: 3,
  uOpacity: 1,
  uBright: 1.05,
  uAudio: 0,
  uAccent: [0xff / 255, 0xb3 / 255, 0x47 / 255],
  uBg: [0x1a / 255, 0x14 / 255, 0x12 / 255],
};

function wrappedSky(ray: SkyRay = IDENTITY_SKY_RAY, span?: SkySpan): string {
  const w = wrapPluginSky(atHostCamera(rawSky, ray, span));
  if ("error" in w) throw new Error(w.error);
  return w.frag;
}

type PackOut = { slots: Float32Array; uniforms: PluginSkySmokeUniforms };

let onFrame: ((frame: VizDataFrame) => void) | null = null;
/** The pack module's antColonyTeardown: drops its colony so the next onFrame starts a fresh one. */
let resetColony: (() => void) | null = null;
let slots = new Float32Array(VIZ_UBO.totalFloats);
let written: Record<string, number | [number, number, number]> = {};

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => ({}),
    writeBuffer: (slot: number, data: number[]) => {
      slots.fill(0, slot * SLOT, (slot + 1) * SLOT);
      slots.set(data.slice(0, SLOT), slot * SLOT);
    },
    writeUniform: (name: string, value: number | [number, number, number]) => {
      written[name] = value;
    },
    writeParticles: () => {},
  };
  const pack = await import("../../../plugins/src/ant-colony/frontend/index");
  resetColony = pack.antColonyTeardown;
  onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
});

afterAll(async () => {
  delete (globalThis as { zoto?: unknown }).zoto;
  await closePluginSkySmokeBrowser();
});

// #231: every row starts from a fresh colony, so its slots don't depend on which rows ran first.
beforeEach(() => {
  resetColony?.();
});

const EMPTY: VizDataFrame = { t: 1, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

/** Ten quiet-LAN frames: four low-rate talkers and one small tcp packet. */
function quietLanFrames(): VizDataFrame[] {
  const talkers = ["gateway", "lan", "internet", "lan"].map((role, i) => ({ id: `192.168.1.${10 + i}`, rate: 0.5, role }));
  const packets = [{ proto: "tcp", size: 80, field: 0.1 }];
  return Array.from({ length: 10 }, (_, i) => ({ ...EMPTY, t: 1 + i * 0.1, talkers, packets }));
}

/** Run the pack's real onFrame over a few frames (the colony digs in over ticks). */
function runPack(frames: VizDataFrame[]): PackOut {
  expect(onFrame, "ant-colony frontend registers zoto.onFrame").toBeTypeOf("function");
  slots = new Float32Array(VIZ_UBO.totalFloats);
  written = {};
  for (const f of frames) onFrame!(f);
  expect(slots[META_CHAMBERS], "pack wrote at least one chamber").toBeGreaterThan(0);
  const u = written;
  return {
    slots: new Float32Array(slots),
    uniforms: {
      ...HOST_DEFAULTS,
      uBright: typeof u.uBright === "number" ? u.uBright : HOST_DEFAULTS.uBright,
      uAudio: typeof u.uAudio === "number" ? u.uAudio : 0,
      uOpacity: typeof u.uOpacity === "number" ? u.uOpacity : 1,
      uAccent: Array.isArray(u.uAccent) ? u.uAccent : HOST_DEFAULTS.uAccent,
      uBg: Array.isArray(u.uBg) ? u.uBg : HOST_DEFAULTS.uBg,
    },
  };
}

/** Same frame with the nest removed: no chambers, no tunnels (pheromone and ants kept). */
function withoutNest(s: Float32Array): Float32Array {
  const out = new Float32Array(s);
  out[META_CHAMBERS] = 0;
  out[META_TUNNELS] = 0;
  out.fill(0, 1 * SLOT, 3 * SLOT);
  return out;
}

/** Share of pixels whose luma moved by at least `step` (0-255) between two renders. */
function changedShare(a: PluginSkySmokeResult, b: PluginSkySmokeResult, step = 2): number {
  const la = a.luma!;
  const lb = b.luma!;
  expect(la.length).toBe(lb.length);
  let n = 0;
  for (let i = 0; i < la.length; i++) if (Math.abs(la[i]! - lb[i]!) >= step) n++;
  return n / la.length;
}

async function expectNestInView(out: PackOut, frag = wrappedSky()): Promise<void> {
  const withNest = await smokeRenderPluginSky(frag, out.slots, out.uniforms, { keepLuma: true });
  const bare = await smokeRenderPluginSky(frag, withoutNest(out.slots), out.uniforms, { keepLuma: true });
  const share = changedShare(withNest, bare);
  const why = `with nest: ${withNest.assertion} / without: ${bare.assertion} / changed share ${share.toFixed(4)}`;
  noteRowNumbers(`nest share (${expect.getState().currentTestName ?? "?"})`, `changed share ${share.toFixed(4)}`);
  expect(withNest.pixelChecksum, `chambers and tunnels must change the host view (${why})`).not.toBe(bare.pixelChecksum);
  // The authored mapping leaves the frame bit-identical without the nest; require a visible share, not one pixel:
  // at least 2% of the view moves by 2/255 luma or more (the nest covers about 4-5% of it).
  expect(share, why).toBeGreaterThan(0.02);
}

function sameLook(a: PluginSkySmokeResult, b: PluginSkySmokeResult, label: string): void {
  expect(Math.abs(a.medianLuma - b.medianLuma), `${label}: ${a.assertion} vs ${b.assertion}`).toBeLessThan(0.004);
  expect(Math.abs(a.litPixelFraction - b.litPixelFraction), `${label}: ${a.assertion} vs ${b.assertion}`).toBeLessThan(0.01);
}

/**
 * QE pick-every-view blank rule (the headed pick-every-view harness, `fivePatchSample`):
 * the wall is black when at least 4 of the 5 patches have mean luma < 24 (0-255) and sd < 4.
 */
const QE_BLACK_LUM = 24;
const QE_BLACK_SD = 4;
const QE_BLACK_MIN_PATCHES = 4;

function qeWall(r: PluginSkySmokeResult): { black: boolean; why: string } {
  const dark = r.qePatches.filter((p) => p.lum < QE_BLACK_LUM && p.sd < QE_BLACK_SD).length;
  const patches = r.qePatches.map((p) => `${p.lum.toFixed(0)}/sd${p.sd.toFixed(1)}`).join(" ");
  return { black: dark >= QE_BLACK_MIN_PATCHES, why: `${dark}/5 dark patches (${patches}) ${r.assertion}` };
}

describe("ant-colony sky frames the formicarium on the host camera", () => {
  it("draws the static cutaway before any frame arrives (no divide by a zero zoom slot)", async () => {
    const frag = wrappedSky();
    const none = await smokeRenderPluginSky(frag, new Float32Array(VIZ_UBO.totalFloats), HOST_DEFAULTS);
    const cutaway = new Float32Array(VIZ_UBO.totalFloats);
    cutaway.set([0.5, 0.45, 1.1]); // colony.ts packSlots "cutaway" camera
    const still = await smokeRenderPluginSky(frag, cutaway, HOST_DEFAULTS);
    expect(none.pixelChecksum, `empty slots ${none.assertion} vs cutaway meta ${still.assertion}`).toBe(still.pixelChecksum);
  }, 60_000);

  it("shows the nest in the host view on a quiet LAN (pack onFrame, low-rate talkers)", async () => {
    await expectNestInView(runPack(quietLanFrames()));
  }, 60_000);

  it("shows the nest in the host view on host idle-fixture frames (pack onFrame)", async () => {
    const frames = Array.from({ length: 10 }, (_, i) => mergeVizIdleFrame({ ...EMPTY, t: 1 + i * 0.1 }, { fixture: "host" }));
    await expectNestInView(runPack(frames));
  }, 60_000);

  it("keeps the wall off QE's black rule on host idle-fixture frames (soil dimmed to 0.7 outside the cut)", async () => {
    const out = runPack(Array.from({ length: 10 }, (_, i) => mergeVizIdleFrame({ ...EMPTY, t: 1 + i * 0.1 }, { fixture: "host" })));
    const wall = qeWall(await smokeRenderPluginSky(wrappedSky(), out.slots, out.uniforms));
    expect(wall.black, `idle wall is black under QE's five-patch rule: ${wall.why}`).toBe(false);
  }, 60_000);

  it("looks the same when the camera sits level (stage-only) or orbits to 15 and 75 degrees", async () => {
    const out = runPack(Array.from({ length: 10 }, (_, i) => mergeVizIdleFrame({ ...EMPTY, t: 1 + i * 0.1 }, { fixture: "host" })));
    const at = (pitch: number) => smokeRenderPluginSky(wrappedSky(parentedSkyRay("ant-colony", rawSky, pitch)), out.slots, out.uniforms);
    const level = await at(0);
    for (const pitch of [15, 75]) sameLook(await at(pitch), level, `pitch ${pitch} vs level`);
    // Control: a world-fixed dome would drift with pitch, so the row can see it.
    const w15 = await smokeRenderPluginSky(wrappedSky(worldDomeSkyRay(15)), out.slots, out.uniforms);
    const w75 = await smokeRenderPluginSky(wrappedSky(worldDomeSkyRay(75)), out.slots, out.uniforms);
    expect(w15.pixelChecksum, "world-fixed dome control should differ across pitch").not.toBe(w75.pixelChecksum);
  }, 90_000);

  /**
   * #231: a runPack row reads the same slots after the rows above that it reads alone. Revert: drop
   * the beforeEach colony reset (this row then carries on the colony those rows grew) -> red.
   */
  it("reads the same quiet-LAN slots after the rows above and on its own (fresh colony per row)", () => {
    const afterOthers = runPack(quietLanFrames()).slots;
    resetColony!();
    const alone = runPack(quietLanFrames()).slots;
    let differ = 0;
    for (let i = 0; i < alone.length; i++) if (afterOthers[i] !== alone[i]) differ++;
    expect(differ, `after the rows above: ${differ} of ${alone.length} floats differ from the row on its own`).toBe(0);
  });
});

/**
 * Ant Colony near-black in the real app (UX Pro headed run at 6b172413, 35 s after pick,
 * 7 devices / 420 pkt/s): five-patch lumas fresh 17/22/26/14/17, shipped 16/23/27/14/17,
 * no pixel reaching luma 40. The idle row above drives the host idle fixture with the pack's
 * own uniforms; the app does neither.
 *
 * Production path: ant-colony is not a VIZ_DEMO_PACK, so viz-present-deliver.ts builds the
 * frame with mainVizBuildFrame (live LAN talkers win over the idle fixture in
 * mergeVizIdleFrame, viz-host.ts:311) and deliverVizPluginFrame only posts it to the pack's
 * sandboxed frontend (viz-frame-tick.ts:29; no runPackFrameHandler case). The frontend's
 * zotoVizSlots writes reach the UBO, but its uBright / uAccent / uBg / uAudio writes are
 * overwritten every frame by scene.ts applyLook -> backdrop setLook / setColors ->
 * syncPluginLook: the sky draws with the look's skyBright 1.05, skyOpacity 1, the ember rim
 * 0xff5e3a as uAccent and the ember clear 0x1a1412 as uBg (the red trails in UX Pro's shot).
 */
describe("ant-colony on the app's production path (live LAN frame, host look uniforms)", () => {
  /** ant-colony look: theme ember, skyBright 1.05, skyOpacity 1, skySpeed 0.35 (uTime ~ 35 s * 0.35). */
  const APP_LOOK = hostLookUniforms({ skyBright: 1.05, skyOpacity: 1, rim: 0xff5e3a, bg: 0x1a1412 }, 12.25);

  function appSlots(): Float32Array {
    expect(normalizeVizDemoPackId("ant-colony"), "no host mirror: only the pack frontend writes").toBeNull();
    // ~35 s of 6 fps delivers would be ~210 frames; the colony settles well inside 60.
    const frames = lanFrames35s({ fixture: "host" }, 2, 60);
    expect(frames.at(-1)!.talkers).toHaveLength(7);
    expect(frames.at(-1)!.demoSlices?.talkers, "live LAN talkers, not the idle fixture").toBeUndefined();
    // #225: a fresh colony for every slot set. The writer has no randomness (colony.ts hashes the
    // look's seed); what made two calls differ was the pack module's colony carrying on from the
    // previous rows' frames.
    resetColony!();
    return runPack(frames).slots;
  }

  /**
   * #225: two fresh app-path slot sets are identical, and so is the wall they draw. Revert: drop
   * the colony reset in appSlots (the second set continues the first set's colony) -> red.
   */
  it("builds identical fresh slot sets on two calls, and they draw the same wall", async () => {
    const a = appSlots();
    const b = appSlots();
    let differ = 0;
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i]! - b[i]!);
      if (d > 0) differ++;
      worst = Math.max(worst, d);
    }
    expect(differ, `fresh slot sets: ${differ} of ${a.length} floats differ, worst ${worst}`).toBe(0);
    const wallA = await appWallLuma(ANT_LOOK_SLIDERS.skyBright, 1, undefined, a);
    const wallB = await appWallLuma(ANT_LOOK_SLIDERS.skyBright, 1, undefined, b);
    expect(wallB, "the two fresh slot sets read back the same wall").toEqual(wallA);
  }, 60_000);

  /**
   * Where QE's patches land depends on where this seed digs the nest for these IPs (UX Pro's
   * shot had all five on bare soil). The soil-only frame keeps meta (camera, day, soil style)
   * and drops chambers, tunnels, pheromone and ants: the wall the patches see when they miss.
   */
  function soilOnly(s: Float32Array): Float32Array {
    const out = withoutNest(s);
    out.fill(0, 3 * SLOT, 8 * SLOT);
    return out;
  }

  async function appWall(slots: Float32Array, png: string) {
    // App camera: stage-only levelled, lensFov-clamped 64 x 42.7 degrees at 1280 x 800.
    const frag = wrappedSky(parentedSkyRay("ant-colony", rawSky, 0), appLensSkySpan());
    const r = await smokeRenderPluginSky(frag, slots, APP_LOOK, { keepLuma: true, pngPath: pluginSkySmokePngPath(png) });
    const five = fivePatchSummary(appFivePatches(r.luma!));
    const canvas = fivePatchSummary(r.qePatches);
    const maxLuma = Math.round(Math.max(...r.luma!));
    noteRowNumbers(png, `app-region ${five.text}; canvas ${canvas.text}; max luma ${maxLuma}; ${r.assertion}`);
    return { r, five, maxLuma, why: `app-region ${five.text}; canvas ${canvas.text}; max luma ${maxLuma}; ${r.assertion}` };
  }

  function expectLitWall(w: Awaited<ReturnType<typeof appWall>>): void {
    expect(w.five.dark, w.why).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    // Margin: this draw reads ~0.8x brighter than UX Pro's app shot at 6b172413 (bare soil here
    // 20/31/32/17/17 vs app 17/21/26/14/16), so a median of 34 here is ~28 in the app, in
    // Roto Proto's app ballpark (27/25/24/28/30).
    expect(w.five.median, w.why).toBeGreaterThanOrEqual(34);
    expect(Math.max(...w.five.lums), `not blown out: ${w.why}`).toBeLessThan(200);
  }

  it("keeps the wall lit for a 7-talker 420 pkt/s LAN at the levelled host camera (UX Pro five-patch rule)", async () => {
    expectLitWall(await appWall(appSlots(), "ant-colony-prod-lan-35s"));
  }, 60_000);

  it("keeps the bare soil lit on that frame where QE's patches miss the nest", async () => {
    expectLitWall(await appWall(soilOnly(appSlots()), "ant-colony-prod-lan-35s-soil"));
  }, 60_000);

  it("still shows the nest on that frame (chambers and tunnels move >= 2% of the view)", async () => {
    await expectNestInView({ slots: appSlots(), uniforms: APP_LOOK }, wrappedSky(parentedSkyRay("ant-colony", rawSky, 0), appLensSkySpan()));
  }, 60_000);

  /**
   * The same wall 35 s and 60 s after the pick, drawn with the sky look the app actually uses
   * then. UX Pro's headed run at fd97fbdb: lit at 35 s, black by area at 60 s; the v5 sweep
   * (Ant picked after other packs) black at 35 s. Under SwiftShader the app runs ~5-6 fps, so
   * core/perf.ts auto-tune leans once the 30 s window reads < 10 fps, and perfOverlay eases the
   * look's skyBright to 0.4 and skyOpacity to 0.45. scene.ts applyLook takes the sky sliders
   * from that overlay (skyLookFor): the stage-only sky is the whole picture, drawn at 0.4 / 1.05
   * of its brightness and 45% over the ember clear.
   * Timeline: the real fps.ts trail + tickPerf at APP_FPS from boot, notePerfChange at each pick
   * (scene.ts:1996), then the real perfOverlay + skyLookFor. The draw is composited like the
   * app's transparent sky over a clear: since #188 the smoke harness itself blends SRC_ALPHA,
   * out = sky * uOpacity + clear * (1 - uOpacity) per channel, over PLUGIN_SKY_SMOKE_CLEAR, so these
   * rows use its read-back unchanged (#223: the hand blend on top of it blended twice below opacity 1).
   * Pass lines are the app's own: UX Pro five-patch (<= 2 of 5 below 24) and QE v5 area (>= 1% of
   * the view at luma >= 40).
   */
  const ANT_LOOK_SLIDERS = { skyBright: 1.05, skyOpacity: 1 };
  const APP_FPS = 6;
  const PERF_SRC: PerfSrc = {
    labelCount: 20, partAmt: 1, partCap: 400, partPeak: 24, partSize: 1, edgeGlowAmt: 1, skySpeed: 0.35,
    ...ANT_LOOK_SLIDERS,
  };

  /** Sky sliders at `atS` s after boot with Ant picked at `picks.at(-1)` s (earlier picks = other packs). */
  function appSkyLookAt(picks: number[], atS: number) {
    resetFps();
    resetPerf();
    const step = 1000 / APP_FPS;
    let next = 0;
    for (let t = 0; t <= atS * 1000; t += step) {
      while (next < picks.length && t >= picks[next]! * 1000) { notePerfChange(t); next++; }
      markFrame(t as FrameTs);
      tickPerf(t, true, 0.45);
    }
    const stress = perfStress();
    const look = skyLookFor(ANT_LOOK_SLIDERS, perfOverlay(PERF_SRC, stress));
    resetFps();
    resetPerf();
    return { ...look, stress };
  }

  /**
   * The app-path Ant wall (live LAN slots, host look, app lens) at the given sky sliders, per-pixel
   * luma 0-255. The harness has already composited uOpacity over its clear (#188), so the read-back
   * is the composited picture (#223).
   */
  async function appWallLuma(bright: number, opacity: number, png?: string, slots = appSlots()): Promise<number[]> {
    const uniforms = { ...APP_LOOK, uBright: bright, uOpacity: opacity };
    const frag = wrappedSky(parentedSkyRay("ant-colony", rawSky, 0), appLensSkySpan());
    const r = await smokeRenderPluginSky(frag, slots, uniforms, { keepLuma: true, pngPath: png ? pluginSkySmokePngPath(png) : undefined });
    return r.luma!;
  }

  async function appWallAt(picks: number[], afterPickS: number, png: string) {
    const at = picks.at(-1)! + afterPickS;
    const look = appSkyLookAt(picks, at);
    const luma = await appWallLuma(look.bright, look.opacity, png);
    const five = fivePatchSummary(appFivePatches(luma));
    const lit40 = luma.filter((v) => v >= 40).length / luma.length;
    const sorted = [...luma].sort((a, b) => a - b);
    const bg = sorted[Math.floor(sorted.length * 0.01)]!;
    const litBg = luma.filter((v) => v > bg + 10).length / luma.length;
    const why = `t=${at}s (pick ${picks.at(-1)}s +${afterPickS}s, ${APP_FPS} fps) perf stress ${look.stress.toFixed(3)} -> uBright ${look.bright.toFixed(3)} uOpacity ${look.opacity.toFixed(3)}; composited app-region ${five.text}; lit(>=40) ${(lit40 * 100).toFixed(2)}%; lit(>bg ${bg.toFixed(1)}+10) ${(litBg * 100).toFixed(2)}%`;
    noteRowNumbers(png, why);
    expect(five.dark, why).toBeLessThanOrEqual(UXPRO_MAX_DARK);
    expect(lit40, `black by area (QE v5: < 1% at luma >= 40): ${why}`).toBeGreaterThanOrEqual(0.01);
  }

  it("stays lit 35 s after Ant is the first pick after boot (app perf lean at SwiftShader fps)", async () => {
    await appWallAt([10], 35, "ant-colony-prod-lan-first-pick-35s");
  }, 60_000);

  it("stays lit 60 s after Ant is the first pick after boot (app perf lean at SwiftShader fps)", async () => {
    await appWallAt([10], 60, "ant-colony-prod-lan-first-pick-60s");
  }, 60_000);

  it("stays lit 35 s after Ant is picked after Blob Mesh in the same session", async () => {
    await appWallAt([10, 40], 35, "ant-colony-prod-lan-after-blob-35s");
  }, 60_000);

  it("stays lit 60 s after Ant is picked after Blob Mesh in the same session", async () => {
    await appWallAt([10, 40], 60, "ant-colony-prod-lan-after-blob-60s");
  }, 60_000);

  /**
   * #223: below opacity 1 the app-path wall is one composite over the harness clear,
   * out = sky x a + clear x (1 - a), not a second blend on top of the harness's. Ant's look is
   * opacity 1 since #177; the row draws it at 0.5 through appWallLuma, the path the rows above use.
   * Revert: put the hand blend back in appWallLuma (luma x a + clear x (1 - a) again) -> red.
   */
  it("draws the app-path wall at opacity 0.5: one composite sky x a + clear x (1 - a) over PLUGIN_SKY_SMOKE_CLEAR", async () => {
    const a = 0.5;
    const clearLuma = 0.2126 * Math.round(255 * PLUGIN_SKY_SMOKE_CLEAR[0]) + 0.7152 * Math.round(255 * PLUGIN_SKY_SMOKE_CLEAR[1])
      + 0.0722 * Math.round(255 * PLUGIN_SKY_SMOKE_CLEAR[2]);
    // One live-LAN slot set for every draw: the pack's writer is not frame-to-frame identical.
    const slots = appSlots();
    const opaque = await appWallLuma(ANT_LOOK_SLIDERS.skyBright, 1, undefined, slots);
    const again = await appWallLuma(ANT_LOOK_SLIDERS.skyBright, 1, undefined, slots);
    const half = await appWallLuma(ANT_LOOK_SLIDERS.skyBright, a, undefined, slots);
    expect(again, "the same slots and sliders draw the same wall").toEqual(opaque);
    expect(half).toHaveLength(opaque.length);
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < opaque.length; i++) {
      const d = Math.abs(half[i]! - (opaque[i]! * a + clearLuma * (1 - a)));
      sum += d;
      worst = Math.max(worst, d);
    }
    const mean = sum / opaque.length;
    const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1]!;
    const why = `a ${a}: mean |luma - composite| ${mean.toFixed(3)}, worst ${worst.toFixed(3)}; median opaque ${median(opaque).toFixed(2)} half ${median(half).toFixed(2)} clear ${clearLuma.toFixed(2)}`;
    noteRowNumbers("ant-colony-prod-lan-opacity-0.5", why);
    expect(median(opaque) - median(half), `the opacity shows in the read-back: ${why}`).toBeGreaterThan(10);
    expect(mean, `single composite: ${why}`).toBeLessThanOrEqual(0.75);
    expect(worst, `single composite: ${why}`).toBeLessThanOrEqual(2);
  }, 60_000);
});
