import { describe, expect, it } from "vitest";
import { OVERVIEW_MARBLE_SCALE, liftSpeedFor, marbleViewScale, lowFpsFor } from "./pack";

describe("marble polish hooks", () => {
  it("draws marbles larger in the overview than in chase/follow", () => {
    expect(marbleViewScale("wide")).toBe(OVERVIEW_MARBLE_SCALE);
    expect(marbleViewScale("orbit")).toBeGreaterThan(1);
    expect(marbleViewScale("chase")).toBe(1);
    expect(marbleViewScale("follow")).toBe(1);
  });
  it("flags low fps only under ~30 fps", () => {
    expect(lowFpsFor(1 / 60)).toBe(false);
    expect(lowFpsFor(1 / 20)).toBe(true);
  });
  it("idle frames run the lift at base speed", () => {
    expect(liftSpeedFor(400, false, true)).toBeCloseTo(0.42);
    expect(liftSpeedFor(400, false, false)).toBeCloseTo(0.92);
    expect(liftSpeedFor(400, true, false)).toBe(0.4);
  });
});
