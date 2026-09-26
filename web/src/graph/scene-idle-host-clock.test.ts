import { afterEach, describe, expect, it, vi } from "vitest";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import type { FrameTs } from "../core/time-ms";
import type { NetScene } from "./scene";
import { TetrisView } from "../arcade/tetris";

const FRAME_MS = 16;
const FRAMES = 600;

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as NetScene;
}

class TetrisHarness extends TetrisView {
  onPollEmpty(): void {
    this.onTrafficPollEmpty();
  }
}

describe("Stage3D hostFrameTick wall clock", () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetVizClockInjectors();
    vi.restoreAllMocks();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("600 hostFrameTick calls: hostFrameTick never reads performance.now or Date.now", () => {
    clock = 0;
    setVizClockInjector(() => clock);
    const perfSpy = vi.spyOn(performance, "now");
    const dateSpy = vi.spyOn(Date, "now");
    const host = document.createElement("div");
    host.style.width = "400px";
    host.style.height = "300px";
    Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 300 });
    document.body.append(host);
    hosts.push(host);
    const view = new TetrisHarness(host, mockScene());
    view.start();
    view.testSetIdleSeed(42);
    view.onPollEmpty();
    perfSpy.mockClear();
    dateSpy.mockClear();
    let prev = clock;
    for (let i = 0; i < FRAMES; i++) {
      clock += FRAME_MS;
      const dtSec = (clock - prev) / 1000;
      prev = clock;
      view.hostFrameTick(clock as FrameTs, dtSec);
    }
    expect(perfSpy).not.toHaveBeenCalled();
    expect(dateSpy).not.toHaveBeenCalled();
  });
});
