import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapPluginSky } from "./plugin-sky-probe";
import {
  closePluginSkySmokeBrowser,
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
  type SkyRay,
} from "./pack-sky-host-camera-test-helper";

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

function wrappedSky(ray: SkyRay = IDENTITY_SKY_RAY): string {
  const w = wrapPluginSky(atHostCamera(rawSky, ray));
  if ("error" in w) throw new Error(w.error);
  return w.frag;
}

type PackOut = { slots: Float32Array; uniforms: PluginSkySmokeUniforms };

let onFrame: ((frame: VizDataFrame) => void) | null = null;
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
  await import("../../../plugins/src/ant-colony/frontend/index");
  onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
});

afterAll(async () => {
  delete (globalThis as { zoto?: unknown }).zoto;
  await closePluginSkySmokeBrowser();
});

const EMPTY: VizDataFrame = { t: 1, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

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

async function expectNestInView(out: PackOut): Promise<void> {
  const frag = wrappedSky();
  const withNest = await smokeRenderPluginSky(frag, out.slots, out.uniforms, { keepLuma: true });
  const bare = await smokeRenderPluginSky(frag, withoutNest(out.slots), out.uniforms, { keepLuma: true });
  const share = changedShare(withNest, bare);
  const why = `with nest: ${withNest.assertion} / without: ${bare.assertion} / changed share ${share.toFixed(4)}`;
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
    const talkers = ["gateway", "lan", "internet", "lan"].map((role, i) => ({ id: `192.168.1.${10 + i}`, rate: 0.5, role }));
    const packets = [{ proto: "tcp", size: 80, field: 0.1 }];
    const frames = Array.from({ length: 10 }, (_, i) => ({ ...EMPTY, t: 1 + i * 0.1, talkers, packets }));
    await expectNestInView(runPack(frames));
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
});
