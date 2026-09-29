import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { perfOverlay, resetPerf } from "../core/perf";
import { resetFps } from "../core/fps";
import { NetScene } from "./scene";

/**
 * Wiring guard for bbf8b77d: scene.ts applyLook must hand backdrop.setLook the look's own sky
 * sliders on a stage-only view even while the perf lean (core/perf.ts perfOverlay: skyBright
 * 0.4, skyOpacity 0.45) is on, and the leaned sliders on a graph view. The Ant Colony rows call
 * skyLookFor directly; this row goes through the real NetScene.applyLook.
 */
type SceneInternals = {
  anim: { backdrop: string; skyBright: number; skyOpacity: number; skyAudio: boolean };
  tune: ReturnType<typeof perfOverlay> | null;
  backdrop: { setLook: (opacity: number, brightness: number, audio: number) => void };
  visScale: number;
  applyLook(dt: number): void;
  thermalSkyK(): number;
};

describe("NetScene applyLook: stage-only plugin sky under the perf lean", () => {
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

  /** A NetScene on the Ant Colony look (plugin backdrop, skyBright 1.05, skyOpacity 0.96), fully leaned. */
  function leanedScene(stageOnly: boolean) {
    const el = document.createElement("div");
    el.style.width = "640px";
    el.style.height = "480px";
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(el);
    hosts.push(el);
    const graph = new NetScene(el);
    graph.setActive(false);
    graph.setStageOnly(stageOnly);
    const s = graph as unknown as SceneInternals;
    Object.assign(s.anim, { backdrop: "plugin", skyBright: 1.05, skyOpacity: 0.96 });
    s.tune = perfOverlay(s.anim as unknown as Parameters<typeof perfOverlay>[0], 1);
    expect(s.tune.skyBright, "overlay leaned").toBeCloseTo(0.4, 9);
    expect(s.tune.skyOpacity, "overlay leaned").toBeCloseTo(0.45, 9);
    const setLook = vi.spyOn(s.backdrop, "setLook");
    s.applyLook(1 / 60);
    expect(setLook).toHaveBeenCalledTimes(1);
    const [opacity, brightness] = setLook.mock.calls[0]!;
    console.info(`[stage-sky-lean] stageOnly=${stageOnly} setLook(opacity ${opacity}, brightness ${brightness}); look ${s.anim.skyOpacity}/${s.anim.skyBright}, tune ${s.tune.skyOpacity}/${s.tune.skyBright}, thermalSkyK ${s.thermalSkyK()}, visScale ${s.visScale}`);
    return { s, opacity, brightness };
  }

  it("stage-only: setLook gets the look's own skyOpacity and skyBright x thermalSkyK, not the lean", () => {
    const { s, opacity, brightness } = leanedScene(true);
    const thermal = s.thermalSkyK();
    expect(opacity, `opacity (lean would be ${s.tune!.skyOpacity})`).toBeCloseTo(s.anim.skyOpacity, 6);
    expect(brightness, `brightness = ${s.anim.skyBright} x thermal ${thermal} (lean would be ${s.tune!.skyBright * thermal})`)
      .toBeCloseTo(s.anim.skyBright * thermal, 6);
  });

  it("graph view: setLook still gets the leaned skyOpacity 0.45 and skyBright 0.4 x thermalSkyK x visScale", () => {
    const { s, opacity, brightness } = leanedScene(false);
    const thermal = s.thermalSkyK();
    expect(opacity).toBeCloseTo(s.tune!.skyOpacity, 6);
    expect(brightness, `brightness = 0.4 x thermal ${thermal} x visScale ${s.visScale}`).toBeCloseTo(s.tune!.skyBright * thermal * s.visScale, 6);
  });
});
