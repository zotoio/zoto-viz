import { describe, expect, it } from "vitest";
import { ACTIVITY_CENTER_HOLD, activityCenterHold, activityLookMix, centerMixForNdc } from "./cam-center";

describe("activityCenterHold", () => {
  it("stays on-center at least 70% of a zoom cycle", () => {
    let high = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) if (activityCenterHold(i / n) > 0.5) high++;
    expect(high / n).toBeGreaterThanOrEqual(ACTIVITY_CENTER_HOLD);
  });

  it("wanders at zoom-out and holds at zoom-in", () => {
    expect(activityCenterHold(0)).toBeLessThan(0.15);
    expect(activityCenterHold(1)).toBeLessThan(0.15);
    expect(activityCenterHold(0.5)).toBeGreaterThan(0.95);
  });
});

describe("activityLookMix", () => {
  it("does not steal a pinned or whole-graph framing", () => {
    expect(activityLookMix({ focus: "activity", pinned: true, focusW: 1, phase: 0.5 })).toBe(0);
    expect(activityLookMix({ focus: "cloud", pinned: false, focusW: 1, phase: 0.5 })).toBe(0);
  });

  it("tracks activity at zoom-in", () => {
    expect(activityLookMix({ focus: "activity", pinned: false, focusW: 1, phase: 0.5 })).toBeGreaterThan(0.95);
    expect(activityLookMix({ focus: "motion", pinned: false, focusW: 1, phase: 0.5 })).toBeGreaterThan(0.95);
  });
});

describe("centerMixForNdc", () => {
  it("does not pull when activity is already in the central 70%", () => {
    expect(centerMixForNdc(0.2, -0.4)).toBe(0);
    expect(centerMixForNdc(0.7, 0)).toBe(0);
  });

  it("pulls just enough to bring a corner point back inside", () => {
    const k = centerMixForNdc(1, 1);
    expect(k).toBeGreaterThan(0.2);
    expect((1 - k) * 1).toBeLessThanOrEqual(ACTIVITY_CENTER_HOLD + 1e-6);
  });
});
