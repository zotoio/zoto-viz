import { beforeEach, describe, expect, it } from "vitest";
import {
  packHostPerfOverheadProbe,
  packHostPerfSnapshot,
  resetPackHostPerf,
  notePackHostPresentInterval,
  notePackWriteBatch,
  PACK_PERF_STORE,
} from "./pack-host-perf";

describe("pack-host-perf", () => {
  beforeEach(() => {
    localStorage.removeItem(PACK_PERF_STORE);
    resetPackHostPerf();
  });

  it("is near-zero overhead when disabled", () => {
    const ms = packHostPerfOverheadProbe();
    expect(ms).toBeLessThan(1);
  });

  it("records frame intervals when enabled", () => {
    localStorage.setItem(PACK_PERF_STORE, "1");
    notePackHostPresentInterval(16.7);
    notePackHostPresentInterval(16.8);
    notePackWriteBatch(1, 128);
    const snap = packHostPerfSnapshot(1000);
    expect(snap.enabled).toBe(true);
    expect(snap.frames).toBe(2);
    expect(snap.writes.batchesPerFrame).toBeGreaterThan(0);
  });
});
