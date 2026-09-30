import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NetScene } from "../graph/scene";
import { mockPartial } from "../../test-support/mock-partial";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { allTKinds } from "./tetris-engine";
import { TetrisView } from "./tetris";
import { bindTetrisStandaloneHost } from "./tetris-standalone-host";

const FRAME_MS = 16;
const FRAME_BUDGET = 20_000;
const MIN_T_SURVIVAL = 48;

function mockScene(): NetScene {
  return mockPartial<NetScene>({
    pulseNow: mockPartial<NetScene["pulseNow"]>({ level: 0 }),
    selectedIp: "",
    deviceOf: () => undefined,
    selectIp: () => {},
  });
}

class TetrisHarness extends TetrisView {
  onPollEmpty(): void {
    this.onTrafficPollEmpty();
  }
}

describe("Tetris T-piece handling", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetVizClockInjectors();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("survives a long all-T sequence with line clears", () => {
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
    view.testPrimeQueue(allTKinds(MIN_T_SURVIVAL));
    bindTetrisStandaloneHost(graph, view);
    for (let i = 0; i < FRAME_BUDGET && view.testScore() < MIN_T_SURVIVAL; i++) {
      clock += FRAME_MS;
      graph.testIdleHostFrame(clock);
    }
    expect(view.testTopoutHoldUntil()).toBe(0);
    expect(view.testScore()).toBe(MIN_T_SURVIVAL);
    expect(view.testLineClears()).toBe(8);
  });
});
