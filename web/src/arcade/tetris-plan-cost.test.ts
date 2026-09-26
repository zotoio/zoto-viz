import { afterEach, describe, expect, it } from "vitest";
import { NetScene } from "../graph/scene";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { TetrisView } from "./tetris";
import { bindTetrisStandaloneHost } from "./tetris-standalone-host";

const FRAME_MS = 16;
const FRAMES = 600;
/** Idle seed 42, 600 host frames @ 16 ms: planner calls and placement evaluations. */
const EXPECTED_PLAN_CALLS = 2;
const EXPECTED_PLACEMENT_EVALS = 68;
const EXPECTED_LOCKED_PIECES = 1;

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as NetScene;
}

class TetrisHarness extends TetrisView {
  tick(now: number, dt: number): void {
    this.step(now, dt);
  }
  onPollEmpty(): void {
    this.onTrafficPollEmpty();
  }
}

describe("TetrisView planner cost", () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetVizClockInjectors();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  function mount(): { view: TetrisHarness; graph: NetScene } {
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
    view.testSetIdleSeed(42);
    view.onPollEmpty();
    bindTetrisStandaloneHost(graph, view);
    return { view, graph };
  }

  function advanceFrames(view: TetrisHarness, graph: NetScene, frames: number): void {
    for (let i = 0; i < frames; i++) {
      clock += FRAME_MS;
      graph.testIdleHostFrame(clock);
    }
  }

  it("600 frames: one plan per spawn and exact placement search totals", () => {
    const { view, graph } = mount();
    advanceFrames(view, graph, FRAMES);
    expect(view.testPlanCallCount()).toBe(EXPECTED_PLAN_CALLS);
    expect(view.testPlacementsEvaluated()).toBe(EXPECTED_PLACEMENT_EVALS);
    expect(view.testScore()).toBe(EXPECTED_LOCKED_PIECES);
    expect(view.testHasActivePiece()).toBe(true);
    expect(view.testPlanCallCount()).toBe(view.testScore() + 1);
  });
});
