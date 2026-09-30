import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFps } from "../core/fps";
import { resetPerf, setPerfPinnedOff } from "../core/perf";
import { frameTsFromRaf } from "../core/time-ms";
import { NetScene } from "./scene";

/**
 * #177 pin / read through the real frame loop: an active NetScene fed 5 fps host frames for 54 s
 * (the 30 s window reads < 10 fps). Pinned (`?perf=off` -> setPerfPinnedOff(true)), tune.k stays 0
 * on every frame and the scene reports data-perf-lean "pinned-off"; unpinned, the same session
 * leans (tune.k >= 0.9, data-perf-lean "on") and perfLean() reads the overlay's k.
 */
type SceneInternals = { tune: { k: number } | null };

describe("#177 NetScene perf lean pin and read", () => {
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

  function slowSession(pinned: boolean) {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(el);
    hosts.push(el);
    setPerfPinnedOff(pinned);
    const graph = new NetScene(el);
    graph.setActive(true);
    const s = graph as unknown as SceneInternals;
    let maxK = 0;
    const attrs = new Set<string>();
    for (let t = 1000; t <= 55_000; t += 200) {
      graph.hostFrame(frameTsFromRaf(t));
      maxK = Math.max(maxK, s.tune?.k ?? 0);
      attrs.add(`${el.dataset.perfLean}|${el.dataset.perfK}`);
    }
    return { el, graph, k: s.tune?.k ?? -1, maxK, attrs };
  }

  it("pinned off: tune.k is 0 on every frame of a 5 fps session; data-perf-lean pinned-off, data-perf-k 0.00", () => {
    const r = slowSession(true);
    expect(r.maxK, "tune.k over the pinned session").toBe(0);
    expect([...r.attrs]).toEqual(["pinned-off|0.00"]);
    expect(r.graph.perfLean()).toEqual({ pinnedOff: true, lean: "off", k: 0, want: 0 });
  });

  it("unpinned control: the same session leans (tune.k >= 0.9), data-perf-lean on, perfLean().k = tune.k", () => {
    const r = slowSession(false);
    expect(r.k, "tune.k at 55 s").toBeGreaterThanOrEqual(0.9);
    expect(r.el.dataset.perfLean).toBe("on");
    expect(r.el.dataset.perfK).toBe(r.k.toFixed(2));
    const st = r.graph.perfLean();
    expect(st.pinnedOff).toBe(false);
    expect(st.k).toBeCloseTo(r.k, 12);
  });
});
