import { describe, expect, it } from "vitest";
import { BACKDROP_OPTIONS, CYCLE_SKIES, cycleSkyPool } from "./backdrop";
import { liveCam } from "../camera/livecam";

describe("BACKDROP_OPTIONS", () => {
  it("includes live and a cycle pool", () => {
    expect(BACKDROP_OPTIONS.some((o) => o.value === "live")).toBe(true);
    expect(CYCLE_SKIES).toContain("matrix");
    liveCam.setPolicy("off", false);
    expect(cycleSkyPool()).not.toContain("live");
    liveCam.setPolicy("auto", false);
  });
});
