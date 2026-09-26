import { afterEach, describe, expect, it } from "vitest";
import { NetScene } from "../graph/scene";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { TetrisView } from "./tetris";
import { bindTetrisStandaloneHost } from "./tetris-standalone-host";
import { SURVIVAL_BATTERY_SEEDS } from "./tetris-engine";
import { TETRIS_SURVIVAL_FIXTURE } from "./fixtures/tetris-survival-baseline";

const FRAME_MS = 16;
const FRAMES = 600;

/** 600 host idle frames @ 16 ms on TetrisView (standalone host bind). */
const VIEW_600: Record<number, { pieces: number; placementsEvaluated: number }> = {
  0: { pieces: 1, placementsEvaluated: 68 },
  1: { pieces: 2, placementsEvaluated: 104 },
  2: { pieces: 2, placementsEvaluated: 104 },
  3: { pieces: 2, placementsEvaluated: 102 },
  4: { pieces: 2, placementsEvaluated: 102 },
  5: { pieces: 1, placementsEvaluated: 68 },
  6: { pieces: 2, placementsEvaluated: 102 },
  7: { pieces: 1, placementsEvaluated: 68 },
  8: { pieces: 2, placementsEvaluated: 104 },
  9: { pieces: 1, placementsEvaluated: 68 },
  10: { pieces: 2, placementsEvaluated: 102 },
  11: { pieces: 2, placementsEvaluated: 102 },
  12: { pieces: 2, placementsEvaluated: 102 },
  13: { pieces: 1, placementsEvaluated: 68 },
  14: { pieces: 1, placementsEvaluated: 68 },
  15: { pieces: 1, placementsEvaluated: 68 },
  16: { pieces: 1, placementsEvaluated: 68 },
  17: { pieces: 2, placementsEvaluated: 102 },
  18: { pieces: 1, placementsEvaluated: 68 },
  19: { pieces: 2, placementsEvaluated: 102 },
};

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as NetScene;
}

class TetrisHarness extends TetrisView {
  onPollEmpty(): void {
    this.onTrafficPollEmpty();
  }
}

describe("Tetris survival battery", { timeout: 120_000 }, () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetVizClockInjectors();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  function runSeedOnView(seed: number): { pieces: number; placementsEvaluated: number } {
    clock = 0;
    setVizClockInjector(() => clock);
    const host = document.createElement("div");
    host.style.width = "400px";
    host.style.height = "300px";
    Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 300 });
    document.body.append(host);
    hosts.push(host);
    const sceneEl = document.createElement("div");
    sceneEl.style.width = "640px";
    sceneEl.style.height = "480px";
    Object.defineProperty(sceneEl, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(sceneEl, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(sceneEl);
    hosts.push(sceneEl);
    const graph = new NetScene(sceneEl);
    const view = new TetrisHarness(host, mockScene());
    view.start();
    view.testSetIdleSeed(seed);
    view.onPollEmpty();
    bindTetrisStandaloneHost(graph, view);
    for (let i = 0; i < FRAMES; i++) {
      clock += FRAME_MS;
      graph.testIdleHostFrame(clock);
    }
    return { pieces: view.testScore(), placementsEvaluated: view.testPlacementsEvaluated() };
  }

  it("fixture header matches main 6520b01 and generator script", () => {
    expect(TETRIS_SURVIVAL_FIXTURE.mainBaseSha).toBe("6520b014472c05f831ac5204429be2affb8473cb");
    expect(TETRIS_SURVIVAL_FIXTURE.generatorScriptSha).toMatch(/^[a-f0-9]{64}$/);
    expect(TETRIS_SURVIVAL_FIXTURE.seeds).toHaveLength(20);
  });

  it.each(SURVIVAL_BATTERY_SEEDS.map((seed) => [seed] as const))(
    "seed %i survives at least the committed baseline with fixed placement cost",
    (seed) => {
      const want = VIEW_600[seed]!;
      const trace = runSeedOnView(seed);
      expect(trace.pieces).toBe(want.pieces);
      expect(trace.placementsEvaluated).toBe(want.placementsEvaluated);
    },
  );
});
