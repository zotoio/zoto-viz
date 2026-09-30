/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameTs } from "../../core/time-ms";
import { countPackPerfReads } from "../../../test-support/pack-perf-read-counts";
import { importMainEntryModule } from "./main-entry-harness";

const PACK_PERF_STORE = "zoto-viz.packPerf";
const FRAMES = 10;

/**
 * #196: boots the real main.ts with perf off and fires 10 presents through core/fps markFrame, so the
 * real present listener runs its pack-perf step (notePackPerfPresent). Counts only: the step ran 10
 * times, with 0 pack-perf storage reads, 0 URL parses and 0 location.search reads, and nothing recorded.
 */
describe("main.ts boot: present listener pack-perf step with perf off (#196)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
    localStorage.removeItem(PACK_PERF_STORE);
  });

  it("10 presents run the listener's gate 10 times with 0 pack-perf storage reads, URL parses and search reads", async () => {
    window.history.replaceState(null, "", "/");
    localStorage.removeItem(PACK_PERF_STORE);
    await importMainEntryModule();
    // Same module registry as the booted main.ts (importMainEntryModule reset it just before).
    const fps = await import("../../core/fps");
    const report = await import("../pack-perf-report");
    const perf = await import("../../core/pack-host-perf");
    report.resetPackPerfReportGateRunsForTests();
    const reads = countPackPerfReads();
    for (let i = 0; i < FRAMES; i++) fps.markFrame((50_000 + i * 16) as FrameTs);
    expect(report.packPerfReportGateRunsForTests().present, "main.ts present listener -> notePackPerfPresent").toBe(FRAMES);
    expect(reads.packStoreReads(), "localStorage zoto-viz.packPerf reads").toBe(0);
    expect(reads.urlParses(), "new URLSearchParams").toBe(0);
    expect(reads.searchReads(), "location.search reads").toBe(0);
    expect(perf.packPerfEnabled()).toBe(false);
    expect(perf.packHostPerfSnapshot(1).frames).toBe(0);
  }, 30_000);
});
