import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NetScene } from "../graph/scene";
import { mockPartial } from "../../test-support/mock-partial";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { TetrisView } from "./tetris";
import { bindTetrisStandaloneHost } from "./tetris-standalone-host";
import { SURVIVAL_BATTERY_SEEDS } from "./tetris-engine";

const FRAME_MS = 16;
const FRAMES = 600;

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

function idleFingerprint(seed: number): string {
  let clock = 0;
  resetVizClockInjectors();
  setVizClockInjector(() => clock);
  const host = document.createElement("div");
  host.style.width = "400px";
  host.style.height = "300px";
  Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 300 });
  document.body.append(host);
  const sceneEl = document.createElement("div");
  sceneEl.style.width = "640px";
  sceneEl.style.height = "480px";
  Object.defineProperty(sceneEl, "clientWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(sceneEl, "clientHeight", { configurable: true, get: () => 480 });
  document.body.append(sceneEl);
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
  const fp = view.testBoardFingerprint();
  host.remove();
  sceneEl.remove();
  return fp;
}

describe("TetrisView placement determinism", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    resetVizClockInjectors();
  });

  it.each(SURVIVAL_BATTERY_SEEDS.map((seed) => [seed] as const))(
    "seed %i replays the same idle board fingerprint",
    (seed) => {
      expect(idleFingerprint(seed)).toBe(idleFingerprint(seed));
    },
  );
});
