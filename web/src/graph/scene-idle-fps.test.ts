import { afterEach, describe, expect, it, vi } from "vitest";
import * as fps from "../core/fps";
import { hostWindowFps, resetFps } from "../core/fps";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import type { FrameTs } from "../core/time-ms";
import { frameTsFromRaf, monoMs } from "../core/time-ms";
import { NetScene } from "./scene";

const FRAME_MS = 16;
const FRAMES = 600;

describe("NetScene idle host FPS window", () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetFps();
    vi.restoreAllMocks();
    resetVizClockInjectors();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("600 injected 16 ms frames: hostWindowFps is exactly 62.5", () => {
    clock = 0;
    setVizClockInjector(() => clock);
    const el = document.createElement("div");
    el.style.width = "640px";
    el.style.height = "480px";
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(el);
    hosts.push(el);
    const graph = new NetScene(el);
    graph.setActive(false);
    const markSpy = vi.spyOn(fps, "markFrame");
    graph.setStandaloneTileTick(() => {});
    for (let i = 0; i < FRAMES; i++) {
      clock += FRAME_MS;
      graph.hostFrame(frameTsFromRaf(clock));
    }
    expect(hostWindowFps(monoMs(clock), 1000)).toBe(62.5);
    expect(markSpy).toHaveBeenCalledTimes(FRAMES);
  });
});
