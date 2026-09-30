/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import type { FrameTs } from "../../core/time-ms";
import type { PerfLeanState } from "../../core/perf";
import { importMainEntryModule } from "./main-entry-harness";

/**
 * #177: main.ts reads `?perf=off` at boot (`setPerfPinnedOff(perfPinFromSearch(location.search))`).
 * Each row imports the real main.ts with the page URL set, reads the lean through the supported
 * `window.zotoviz.perfLean()`, then drives a 5 fps session through the same module instances the
 * booted app loaded: pinned, tune.k stays 0; not pinned, the lean comes on (k >= 0.9).
 */
type BootedPerf = {
  state: PerfLeanState;
  /** Max tune.k over a < 10 fps session long enough to lean fully when not pinned. */
  slowSessionMaxK: () => Promise<number>;
};

async function bootWithSearch(search: string): Promise<BootedPerf> {
  window.history.replaceState(null, "", `/${search}`);
  await importMainEntryModule();
  const state = (window as unknown as { zotoviz: { perfLean(): PerfLeanState } }).zotoviz.perfLean();
  return {
    state,
    slowSessionMaxK: async () => {
      // Same module registry as the booted main.ts (importMainEntryModule reset it just before).
      const perf = await import("../../core/perf");
      const fps = await import("../../core/fps");
      let maxK = 0;
      for (let t = 0; t <= perf.PERF_HOLD_MS + 24_000; t += 200) {
        fps.markFrame(t as FrameTs);
        perf.tickPerf(t, true, 0.45);
        maxK = Math.max(maxK, perf.perfLeanState().k);
      }
      expect(fps.windowFps(perf.PERF_HOLD_MS + 24_000, perf.PERF_HOLD_MS)!, "the 30 s window reads < 10 fps").toBeLessThan(perf.PERF_FPS);
      return maxK;
    },
  };
}

describe("main.ts boot: ?perf=off pins the perf lean off (#177)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("with ?perf=off the booted app has the lean pinned off, and tune.k stays 0 through a 5 fps session", async () => {
    const b = await bootWithSearch("?perf=off");
    expect(b.state, "window.zotoviz.perfLean() right after boot with ?perf=off").toEqual({ pinnedOff: true, lean: "off", k: 0, want: 0 });
    expect(await b.slowSessionMaxK(), "tune.k over the pinned 5 fps session").toBe(0);
  }, 30_000);

  it("with no perf param the lean is not pinned, and the same 5 fps session leans (k >= 0.9)", async () => {
    const b = await bootWithSearch("");
    expect(b.state.pinnedOff, "window.zotoviz.perfLean().pinnedOff with no query").toBe(false);
    expect(await b.slowSessionMaxK(), "unpinned control").toBeGreaterThanOrEqual(0.9);
  }, 30_000);

  it("a near-miss query (?perf=offx) does not pin the lean", async () => {
    const b = await bootWithSearch("?perf=offx");
    expect(b.state.pinnedOff, "window.zotoviz.perfLean().pinnedOff with ?perf=offx").toBe(false);
    expect(await b.slowSessionMaxK(), "near-miss control leans").toBeGreaterThanOrEqual(0.9);
  }, 30_000);
});
