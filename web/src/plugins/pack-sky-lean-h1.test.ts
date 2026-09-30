/**
 * #180 H1 × the perf lean: what a pack sky actually draws with once uBright / uOpacity are
 * host × pack (backdrop.ts syncPluginLook), through the real NetScene.applyLook -> skyLookFor ->
 * Backdrop.setLook path, with each pack's real onFrame writes forwarded through
 * NetScene.setPluginUniform (the app's writeUniform route).
 *
 * Order: skyLookFor picks the host sliders first, applyLook scales them (thermal, visScale on
 * graph views) and hands them to setLook, and only then does syncPluginLook multiply in the pack's
 * own write. Since #177 the perf lean does not dim the sky on any view (perfOverlay passes the
 * look's skyBright / skyOpacity through), so the lean never reaches the pack's dimming.
 *
 * The lean rows compare a leaned view (perf stress 1) with the same view un-leaned (stress 0, the
 * overlay the running app computes every frame when it is not leaned), both measured in the row,
 * so they do not depend on any pack's own numbers.
 *
 * Ant Colony floor (Pedant / PA): the idle frame writes uBright 0.72 (audio 0); the stage-only
 * sky must draw at >= 0.35 with the lean off and with the lean at its lowest (perf stress 1).
 * Revert: put the sky dim back into perfOverlay (skyBright -> 0.4, skyOpacity -> 0.45 at stress 1)
 * and all three lean rows go red. On Ant's stage-only view the exemption in skyLookFor still keeps
 * the drawn value, so there it is the overlay check that goes red.
 *
 * Talker Storm (its own uBright, 0.8-1.2 since #184) and RF Constellation (uOpacity 0.65-0.9) are graph views with a
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

/**
 * A pack's frontend, loaded for its side effect (it sets zoto.onFrame). The path is built from the id
 * so web/tsconfig.test.json type-checks this file without compiling the pack sources, which build
 * under their own pack config (plugins/sdk alias, pack-local types).
 */
const loadPackFrontend = (id: string): Promise<unknown> => import(`../../../plugins/src/${id}/frontend/index.ts`);

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = zoto;
  for (const id of ["ant-colony", "talker-storm", "rf-constellation"] as const) {
    zoto.onFrame = null;
    await loadPackFrontend(id);
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
  /** Perf stress 0..1 (0 = un-leaned overlay, 1 = fully leaned); null = no overlay at all. */
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
    tune: s.tune ? { k: s.tune.k, bright: s.tune.skyBright, opacity: s.tune.skyOpacity } : null,
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

  it("lean at its lowest (perf stress 1): brightness and opacity equal the same view un-leaned, so the lean does not land on the pack's dimming", () => {
    const writes = antIdleWrites();
    const off = effective("ant-colony", writes, { stageOnly: true, look: ANT_LOOK, stress: 0 });
    const on = effective("ant-colony", writes, { stageOnly: true, look: ANT_LOOK, stress: 1 });
    expect(off.tune!.k, "un-leaned overlay").toBe(0);
    expect(on.tune!.k, "the overlay is fully leaned").toBeCloseTo(1, 9);
    expect(on.tune!.bright, "leaned overlay skyBright = un-leaned (#177)").toBeCloseTo(off.tune!.bright, 9);
    expect(on.tune!.opacity, "leaned overlay skyOpacity = un-leaned (#177)").toBeCloseTo(off.tune!.opacity, 9);
    expect(on.bright, "leaned effective uBright = un-leaned").toBeCloseTo(off.bright, 9);
    expect(on.opacity, "leaned effective uOpacity = un-leaned").toBeCloseTo(off.opacity, 9);
    expect(on.bright, "effective uBright with the lean on").toBeGreaterThanOrEqual(ANT_UBRIGHT_FLOOR);
    expect(on.afterWrite.bright).toBeCloseTo(on.bright, 9);
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

  it("talker-storm: the pack's own uBright (silent and audio 1) at default host settings and at the lowest lean", () => {
    const rows: string[] = [];
    for (const audio of [0, 1]) {
      const w = packWrites("talker-storm", [{ ...EMPTY, audio }]);
      // The pack's formula is pinned in plugins/src/talker-storm/frontend/pack.test.ts (#184); here only
      // that it writes one, and what the sky makes of it (the host mirror no longer writes its own).
      expect(w.uBright, "talker-storm writes its own uBright").toBeTypeOf("number");
      expect(w.uOpacity, "talker-storm writes no uOpacity").toBeUndefined();
      const off = effective("talker-storm", w, { stageOnly: false, look: DEFAULT_LOOK, stress: 0 });
      const on = effective("talker-storm", w, { stageOnly: false, look: DEFAULT_LOOK, stress: 1 });
      expect(off.bright, "un-leaned: host x thermal x visScale x pack").toBeCloseTo(
        DEFAULT_LOOK.skyBright * off.thermal * off.visScale * (w.uBright as number), 9);
      expect(on.tune!.k, "the overlay is fully leaned").toBeCloseTo(1, 9);
      expect(on.bright, `audio ${audio}: leaned effective uBright = un-leaned`).toBeCloseTo(off.bright, 9);
      expect(on.opacity, `audio ${audio}: leaned effective uOpacity = un-leaned`).toBeCloseTo(off.opacity, 9);
      for (const [label, e] of [["default", off], ["lean k=1", on]] as const) {
        rows.push(`audio ${audio} ${label}: uBright ${e.bright.toFixed(3)} uOpacity ${e.opacity.toFixed(3)}`);
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
      const off = effective("rf-constellation", w, { stageOnly: false, look: DEFAULT_LOOK, stress: 0 });
      const on = effective("rf-constellation", w, { stageOnly: false, look: DEFAULT_LOOK, stress: 1 });
      expect(off.opacity, "un-leaned: host x pack").toBeCloseTo(DEFAULT_LOOK.skyOpacity * (w.uOpacity as number), 9);
      expect(on.tune!.k, "the overlay is fully leaned").toBeCloseTo(1, 9);
      expect(on.opacity, `rssi ${rssi ?? "none"}: leaned effective uOpacity = un-leaned`).toBeCloseTo(off.opacity, 9);
      expect(on.bright, `rssi ${rssi ?? "none"}: leaned effective uBright = un-leaned`).toBeCloseTo(off.bright, 9);
      for (const [label, e] of [["default", off], ["lean k=1", on]] as const) {
        rows.push(`rssi ${rssi ?? "none"} ${label}: uBright ${e.bright.toFixed(3)} uOpacity ${e.opacity.toFixed(3)}`);
      }
    }
    noteRowNumbers("pack-sky-lean-h1", `rf-constellation ${rows.join("; ")}`);
  });
});

