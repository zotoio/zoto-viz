/**
 * #180 H1 × the perf lean: what a pack sky actually draws with once uBright / uOpacity are
 * host × pack (backdrop.ts syncPluginLook), through the real NetScene.applyLook -> skyLookFor ->
 * Backdrop.setLook path, with each pack's real onFrame writes forwarded through
 * NetScene.setPluginUniform (the app's writeUniform route).
 *
 * Order on db34704a: skyLookFor picks the host sliders first (stage-only views keep the look's own
 * sliders, graph views take the lean), applyLook scales them (thermal, visScale on graph views)
 * and hands them to setLook, and only then does syncPluginLook multiply in the pack's own write.
 * So on a stage-only view the lean never reaches the pack's dimming.
 *
 * Ant Colony floor (Pedant / PA): the idle frame writes uBright 0.72 (audio 0); the stage-only
 * sky must draw at >= 0.35 with the lean off and with the lean at its lowest (perf stress 1).
 * Revert row: drop the stage-only exemption in skyLookFor (the lean lands on the host value and
 * H1 multiplies after it) -> the lean-on row reads 0.4 x 0.72 = 0.288 and goes red.
 *
 * Talker Storm (uBright 0.4-0.9) and RF Constellation (uOpacity 0.65-0.9) are graph views with a
 * plugin sky: numbers only, for QE / UX Pro's headed re-shoot. No pass line. Set
 * PLUGIN_SKY_PNG_DIR to get the numbers in rows.txt there.
 */
import * as THREE from "three";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { perfOverlay, resetPerf } from "../core/perf";
import { resetFps } from "../core/fps";
import { DREAM_BOUNDS, NetScene } from "../graph/scene";
import { mergeVizIdleFrame, type VizDataFrame } from "./viz-host";
import { noteRowNumbers } from "./pack-sky-lan-frame-test-helper";

const ANT_UBRIGHT_FLOOR = 0.35;
const FRAG = `
void main() {
  fragColor = vec4(mix(uBg, uAccent, 0.5 + 0.5 * normalize(vDir).y) * uBright, uOpacity);
}
`;

type Look = { backdrop: string; skyBright: number; skyOpacity: number; skyAudio: boolean };
type SceneInternals = {
  anim: Look;
  tune: ReturnType<typeof perfOverlay> | null;
  backdrop: {
    setKind(k: string): void;
    setPluginShader(p: { id: string; source: string }, cb: () => null): string | null;
    tick(t: number): void;
    skyMorphing(): boolean;
    mesh: THREE.Mesh;
  };
  applyLook(dt: number): void;
  thermalSkyK(): number;
  visScale: number;
};

type OnFrame = (frame: VizDataFrame) => void;
const packs: Record<string, OnFrame> = {};
let written: Record<string, number | [number, number, number]> = {};
const zoto = {
  onTick: null,
  onConfig: null,
  onFrame: null as OnFrame | null,
  getConfig: () => ({}),
  writeBuffer: () => {},
  writeParticles: () => {},
  writeUniform: (name: string, value: number | [number, number, number]) => { written[name] = value; },
};

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = zoto;
  for (const [id, load] of [
    ["ant-colony", () => import("../../../plugins/src/ant-colony/frontend/index")],
    ["talker-storm", () => import("../../../plugins/src/talker-storm/frontend/index")],
    ["rf-constellation", () => import("../../../plugins/src/rf-constellation/frontend/index")],
  ] as const) {
    zoto.onFrame = null;
    await load();
    expect(zoto.onFrame, `${id} registers zoto.onFrame`).toBeTypeOf("function");
    packs[id] = zoto.onFrame!;
  }
});

afterAll(() => {
  delete (globalThis as { zoto?: unknown }).zoto;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  resetPerf();
  resetFps();
  for (const h of hosts) h.remove();
  hosts.length = 0;
});

const EMPTY: VizDataFrame = { t: 1, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };

/** The pack's own writes for these frames (the last value of each uniform). */
function packWrites(id: string, frames: VizDataFrame[]): Record<string, number | [number, number, number]> {
  written = {};
  for (const f of frames) packs[id]!(f);
  return { ...written };
}

type Case = {
  stageOnly: boolean;
  look: { skyBright: number; skyOpacity: number };
  /** Perf stress 0..1 (1 = the lowest the lean goes: skyBright 0.4, skyOpacity 0.45); null = lean off. */
  stress: number | null;
};

/**
 * A NetScene with this pack's sky bound, the look / lean applied, the crossfade finished, and the
 * pack's writes forwarded each frame. Returns what the pack material draws with.
 */
function effective(id: string, writes: Record<string, number | [number, number, number]>, c: Case) {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 480 });
  document.body.append(el);
  hosts.push(el);
  const graph = new NetScene(el);
  graph.setActive(false);
  graph.setStageOnly(c.stageOnly);
  const s = graph as unknown as SceneInternals;
  Object.assign(s.anim, { backdrop: "plugin", ...c.look });
  s.tune = c.stress === null ? null : perfOverlay(s.anim as unknown as Parameters<typeof perfOverlay>[0], c.stress);
  s.backdrop.setKind("plugin");
  expect(s.backdrop.setPluginShader({ id, source: FRAG }, () => null)).toBeNull();
  const send = () => {
    for (const [name, v] of Object.entries(writes)) expect(graph.setPluginUniform(name, v), name).toBe(true);
  };
  const u = () => (s.backdrop.mesh.material as THREE.ShaderMaterial).uniforms;
  let afterWrite = { bright: 0, opacity: 0 };
  for (let f = 0; f <= 240; f++) {
    send();
    afterWrite = { bright: u().uBright.value as number, opacity: u().uOpacity.value as number };
    s.applyLook(1 / 60);
    s.backdrop.tick(f / 60);
  }
  expect(s.backdrop.skyMorphing(), "crossfade done").toBe(false);
  const out = {
    bright: u().uBright.value as number,
    opacity: u().uOpacity.value as number,
    afterWrite,
    thermal: s.thermalSkyK(),
    visScale: s.visScale,
    tune: s.tune ? { bright: s.tune.skyBright, opacity: s.tune.skyOpacity } : null,
  };
  noteRowNumbers(
    "pack-sky-lean-h1",
    `${id} stageOnly=${c.stageOnly} look ${c.look.skyBright}/${c.look.skyOpacity} stress ${c.stress}`
    + ` pack uBright ${writes.uBright ?? "-"} uOpacity ${writes.uOpacity ?? "-"}`
    + ` -> effective uBright ${out.bright.toFixed(4)} uOpacity ${out.opacity.toFixed(4)}`
    + ` (thermal ${out.thermal}, visScale ${out.visScale}, tune ${JSON.stringify(out.tune)})`,
  );
  return out;
}

describe("#180 H1 × perf lean: Ant Colony's stage-only sky keeps its own brightness (floor 0.35)", () => {
  /** ant-colony visualisation.yml look: stageOnly, skyBright 1.05, skyOpacity 1. */
  const ANT_LOOK = { skyBright: 1.05, skyOpacity: 1 };

  function antIdleWrites() {
    const frames = Array.from({ length: 10 }, (_, i) => ({
      ...mergeVizIdleFrame({ ...EMPTY, t: 1 + i * 0.1 }, { fixture: "host" }),
      audio: 0,
    }));
    const w = packWrites("ant-colony", frames);
    expect(w.uBright, "the idle frame's own dimming (0.72 + audio x 0.28, audio 0)").toBeCloseTo(0.72, 9);
    return w;
  }

  it("lean off: effective uBright = look 1.05 x pack 0.72 >= 0.35", () => {
    const e = effective("ant-colony", antIdleWrites(), { stageOnly: true, look: ANT_LOOK, stress: null });
    expect(e.bright, "effective uBright").toBeGreaterThanOrEqual(ANT_UBRIGHT_FLOOR);
    expect(e.bright).toBeCloseTo(1.05 * e.thermal * 0.72, 9);
    expect(e.afterWrite.bright, "same value right after the pack's write").toBeCloseTo(e.bright, 9);
  });

  it("lean at its lowest (perf stress 1 -> skyBright 0.4, skyOpacity 0.45): the lean does not land on the pack's 0.72", () => {
    const e = effective("ant-colony", antIdleWrites(), { stageOnly: true, look: ANT_LOOK, stress: 1 });
    expect(e.tune!.bright, "the overlay is fully leaned").toBeCloseTo(0.4, 9);
    expect(e.tune!.opacity, "the overlay is fully leaned").toBeCloseTo(0.45, 9);
    expect(e.bright, `effective uBright with the lean on (lean x pack would be ${(0.4 * 0.72).toFixed(3)})`)
      .toBeGreaterThanOrEqual(ANT_UBRIGHT_FLOOR);
    expect(e.bright).toBeCloseTo(1.05 * e.thermal * 0.72, 9);
    expect(e.opacity, "the look's own opacity x pack 1").toBeCloseTo(1, 9);
    expect(e.afterWrite.bright).toBeCloseTo(e.bright, 9);
  });

  it("host brightness at its lowest user setting (slider 0%): user x pack, never darker than the user's own choice", () => {
    const low = DREAM_BOUNDS.bright.min;
    expect(low, "the brightness slider's lowest stop").toBe(0);
    const writes = antIdleWrites();
    for (const stress of [null, 1]) {
      const e = effective("ant-colony", writes, { stageOnly: true, look: { ...ANT_LOOK, skyBright: low }, stress });
      // No rule that honours the slider can hold 0.35 here: before H1 the sky drew at the host's 0 too.
      expect(e.bright, `stress ${stress}`).toBeCloseTo(low * e.thermal * 0.72, 9);
    }
    // The lowest slider stop that still keeps the 0.35 floor with the pack's own 0.72.
    const step = DREAM_BOUNDS.bright.step;
    let stop = low;
    while (stop * 0.72 < ANT_UBRIGHT_FLOOR - 1e-9) stop = Math.round((stop + step) * 100) / 100;
    for (const stress of [null, 1]) {
      const at = effective("ant-colony", writes, { stageOnly: true, look: { ...ANT_LOOK, skyBright: stop }, stress });
      const below = effective("ant-colony", writes, { stageOnly: true, look: { ...ANT_LOOK, skyBright: stop - step }, stress });
      noteRowNumbers("pack-sky-lean-h1", `ant-colony floor break-even: slider ${Math.round(stop * 100)}% -> ${at.bright.toFixed(4)}, ${Math.round((stop - step) * 100)}% -> ${below.bright.toFixed(4)} (stress ${stress})`);
      expect(at.bright).toBeGreaterThanOrEqual(ANT_UBRIGHT_FLOOR);
      expect(below.bright).toBeLessThan(ANT_UBRIGHT_FLOOR);
    }
    expect(stop, "break-even slider stop").toBe(0.5);
  });
});

describe("#180 H1 × perf lean: effective values for Talker Storm and RF Constellation (numbers only)", () => {
  /** Both looks are `backdrop: plugin` on a graph view with the scene's default sliders (1 / 1). */
  const DEFAULT_LOOK = { skyBright: 1, skyOpacity: 1 };

  it("talker-storm: pack uBright 0.4 (silent) .. 0.9 (audio 1) at default host settings and at the lowest lean", () => {
    const rows: string[] = [];
    for (const audio of [0, 1]) {
      const w = packWrites("talker-storm", [{ ...EMPTY, audio }]);
      expect(w.uBright).toBeCloseTo(0.4 + audio * 0.5, 9);
      expect(w.uOpacity, "talker-storm writes no uOpacity").toBeUndefined();
      for (const stress of [null, 1]) {
        const e = effective("talker-storm", w, { stageOnly: false, look: DEFAULT_LOOK, stress });
        const host = stress === null ? 1 : 0.4;
        expect(e.bright).toBeCloseTo(host * e.thermal * e.visScale * (w.uBright as number), 9);
        expect(e.opacity).toBeCloseTo(stress === null ? 1 : 0.45, 9);
        rows.push(`audio ${audio} ${stress === null ? "default" : "lean k=1"}: uBright ${e.bright.toFixed(3)} uOpacity ${e.opacity.toFixed(3)}`);
      }
    }
    noteRowNumbers("pack-sky-lean-h1", `talker-storm ${rows.join("; ")}`);
  });

  it("rf-constellation: pack uOpacity 0.65 (no beacons) .. 0.9 (rssi 1) at default host settings and at the lowest lean", () => {
    const rows: string[] = [];
    for (const rssi of [null, 1]) {
      const rf = rssi === null ? [] : [{ ssid: "a", rssi, channel: 36 }, { ssid: "b", rssi, channel: 149 }];
      const w = packWrites("rf-constellation", [{ ...EMPTY, rf }]);
      expect(w.uOpacity).toBeCloseTo(0.65 + (rssi ?? 0) * 0.25, 9);
      expect(w.uBright, "rf-constellation writes no uBright").toBeUndefined();
      for (const stress of [null, 1]) {
        const e = effective("rf-constellation", w, { stageOnly: false, look: DEFAULT_LOOK, stress });
        const hostOp = stress === null ? 1 : 0.45;
        expect(e.opacity).toBeCloseTo(hostOp * (w.uOpacity as number), 9);
        expect(e.bright).toBeCloseTo((stress === null ? 1 : 0.4) * e.thermal * e.visScale, 9);
        rows.push(`rssi ${rssi ?? "none"} ${stress === null ? "default" : "lean k=1"}: uBright ${e.bright.toFixed(3)} uOpacity ${e.opacity.toFixed(3)}`);
      }
    }
    noteRowNumbers("pack-sky-lean-h1", `rf-constellation ${rows.join("; ")}`);
  });
});

