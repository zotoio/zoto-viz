import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { resetFps } from "../core/fps";
import { resetPerf } from "../core/perf";
import { frameTsFromRaf } from "../core/time-ms";
import { mergeLook } from "../plugins/plugin";
import { parseLook } from "../plugins/plugin-visualisation";
import { hostLookUniforms } from "../plugins/pack-sky-lan-frame-test-helper";
import { NetScene, type DreamAnim } from "./scene";

/**
 * #175 app brightness -> pack sky uniform. The pack frame rows feed the harness the look's own
 * sliders (pack-sky-lan-frame-test-helper hostLookUniforms: uBright = skyBright, uOpacity =
 * skyOpacity). In the app the same value takes: visualisation.yml look -> parseLook -> mergeLook
 * -> NetScene.setAnim -> applyLook (skyLookFor x thermalSkyK x visScale) -> Backdrop.setLook ->
 * syncPluginLook / applyMorphFade -> the pack sky material's uBright / uOpacity, re-synced every
 * backdrop.tick. This row drives the real frame loop (hostFrame) with the pack's real look and
 * sky source and reads the bound pack material, so a drop anywhere on that path, or a harness
 * that stops matching it, goes red. Pack-written uBright is out of scope here (H1 changes how
 * it combines with the look), so no pack frames are delivered.
 */
type SceneInternals = {
  anim: DreamAnim;
  tune: { k: number } | null;
  visScale: number;
  stageOnly: boolean;
  thermalSkyK(): number;
  backdrop: { pluginMat: THREE.ShaderMaterial | null; pluginSkyId(): string | null };
};

const here = path.dirname(fileURLToPath(import.meta.url));
const packs = path.resolve(here, "../../../plugins/src");

/**
 * The pack's own look numbers, straight from its visualisation.yml (no parseLook / mergeLook), so
 * the row pins each pack's skyBright / skyOpacity without a copy here (#174 option 2 moved
 * blob-mesh to 0.88: the bisected limit 0.8845 in blob-mesh-dark-patches.test.ts).
 */
function ymlLook(id: string): { skyBright: unknown; skyOpacity: unknown } {
  const vis = parseYaml(readFileSync(path.join(packs, id, "visualisation.yml"), "utf8")) as { look?: { skyBright?: unknown; skyOpacity?: unknown } };
  return { skyBright: vis.look?.skyBright, skyOpacity: vis.look?.skyOpacity };
}

function packLook(id: string) {
  const vis = parseYaml(readFileSync(path.join(packs, id, "visualisation.yml"), "utf8")) as { look?: unknown };
  const look = parseLook(vis.look);
  expect(look, `${id} visualisation.yml look`).toBeTruthy();
  return look!;
}

describe("#175 app sky brightness reaches the pack sky uniform (frame-row calibration)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const hosts: HTMLElement[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    resetPerf();
    resetFps();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  /** A NetScene on pack `id`'s look with its sky bound, run through `frames` host frames `stepMs` apart. */
  function packScene(id: string) {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(el);
    hosts.push(el);
    const graph = new NetScene(el);
    const s = graph as unknown as SceneInternals;
    const look = packLook(id);
    const hostDefault = { skyBright: s.anim.skyBright, skyOpacity: s.anim.skyOpacity };
    const yml = ymlLook(id);
    expect(look.backdrop, `${id} draws a pack sky`).toBe("plugin");
    graph.setStageOnly(!!look.stageOnly);
    graph.setAnim(mergeLook(s.anim, look));
    const source = readFileSync(path.join(packs, id, "sky/fragment.glsl"), "utf8");
    expect(graph.setPluginShader({ id, source }), `${id} sky binds`).toBeNull();
    expect(s.backdrop.pluginSkyId(), "pack sky is the drawn material").toBe(id);
    graph.setActive(true);
    let t = 1000;
    const run = (frames: number, stepMs: number) => {
      for (let i = 0; i < frames; i++) graph.hostFrame(frameTsFromRaf((t += stepMs)));
    };
    const drawn = () => {
      const u = s.backdrop.pluginMat!.uniforms;
      return { uBright: u.uBright!.value as number, uOpacity: u.uOpacity!.value as number };
    };
    /** What the frame rows hand the harness for the scene's current sliders (rim / bg unused here). */
    const harness = () => hostLookUniforms({ skyBright: s.anim.skyBright, skyOpacity: s.anim.skyOpacity, rim: 0, bg: 0 });
    /** The row's pin: the yml numbers are real (finite, skyBright not the host default) and reach anim verbatim. */
    const expectYmlLook = () => {
      const why = `${id} visualisation.yml look skyBright ${String(yml.skyBright)} skyOpacity ${String(yml.skyOpacity)}; host default skyBright ${hostDefault.skyBright}`;
      expect(typeof yml.skyBright === "number" && Number.isFinite(yml.skyBright), `finite skyBright: ${why}`).toBe(true);
      expect(typeof yml.skyOpacity === "number" && Number.isFinite(yml.skyOpacity), `finite skyOpacity: ${why}`).toBe(true);
      expect(yml.skyBright, `not the host default (the row can't pass vacuously): ${why}`).not.toBe(hostDefault.skyBright);
      expect([s.anim.skyBright, s.anim.skyOpacity], `look reaches anim verbatim: ${why}`).toEqual([yml.skyBright, yml.skyOpacity]);
    };
    return { graph, s, look, run, drawn, harness, expectYmlLook };
  }

  function expectCalibrated(r: ReturnType<typeof packScene>, what: string) {
    const d = r.drawn();
    const h = r.harness();
    const k = r.s.thermalSkyK() * (r.s.stageOnly ? 1 : r.s.visScale);
    const why = `${what}: pack material uBright ${d.uBright} uOpacity ${d.uOpacity}; harness uBright ${h.uBright} uOpacity ${h.uOpacity}; thermal x vis ${k}; tune.k ${r.s.tune?.k ?? 0}`;
    console.info(`[#175] ${why}`);
    expect(k, `premise: no thermal / visibility scale on ${what}`).toBe(1);
    expect(d.uBright, why).toBeCloseTo(h.uBright, 9);
    expect(d.uOpacity, why).toBeCloseTo(h.uOpacity, 9);
  }

  const lookText = (id: string) => `skyBright ${String(ymlLook(id).skyBright)} / skyOpacity ${String(ymlLook(id).skyOpacity)} from its yml`;
  it(`graph view (blob-mesh, ${lookText("blob-mesh")}): the look's sliders are the drawn uBright / uOpacity, and follow the slider`, () => {
    const r = packScene("blob-mesh");
    expect(r.s.stageOnly, "blob-mesh is a graph view").toBe(false);
    r.expectYmlLook();
    r.run(90, 16); // 1.44 s at 60 fps: past the 1.05 s view morph, far inside the 30 s fps window (no lean)
    expect(r.s.tune?.k ?? 0, "premise: not leaned").toBe(0);
    expectCalibrated(r, "blob-mesh settled");
    r.graph.setAnim({ ...r.s.anim, skyBright: 0.6, skyOpacity: 0.7 }); // the user's slider, after the pick
    r.run(3, 16);
    expect(r.drawn(), "slider move reaches the pack material").toEqual({ uBright: 0.6, uOpacity: 0.7 });
    expectCalibrated(r, "blob-mesh after slider");
  });

  it(`stage-only (ant-colony, ${lookText("ant-colony")}): drawn uBright / uOpacity are the look's, un-leaned and fully leaned`, () => {
    const r = packScene("ant-colony");
    expect(r.s.stageOnly, "ant-colony is stage-only").toBe(true);
    r.expectYmlLook();
    r.run(90, 16);
    expect(r.s.tune?.k ?? 0, "premise: not leaned").toBe(0);
    expectCalibrated(r, "ant-colony un-leaned");
    r.run(270, 200); // 54 s at 5 fps: the 30 s window reads < 10 fps and the lean comes fully on
    expect(r.s.tune?.k ?? 0, "premise: fully leaned").toBeGreaterThanOrEqual(0.9);
    expectCalibrated(r, "ant-colony leaned");
    r.graph.setAnim({ ...r.s.anim, skyBright: 0.6 });
    r.run(3, 200);
    expect(r.drawn().uBright, "slider move reaches the pack material while leaned").toBe(0.6);
    expectCalibrated(r, "ant-colony leaned after slider");
  });
});
