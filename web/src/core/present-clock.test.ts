import { afterEach, describe, expect, it } from "vitest";
import { markPresent, presentFrameStats, presentInterval, resetPresentClock } from "./present-clock";

describe("present-clock", () => {
  afterEach(() => resetPresentClock());

  it("measures present-to-present interval in ms", () => {
    markPresent(1000);
    markPresent(1029);
    expect(presentInterval()).toBe(29);
  });

  it("tracks rolling p95 present intervals", () => {
    for (let i = 0; i < 20; i++) markPresent(1000 + i * 16.7);
    const { p95, last } = presentFrameStats();
    expect(last).toBeGreaterThan(16);
    expect(p95).toBeGreaterThan(16);
  });
});
