import { afterEach, describe, expect, it } from "vitest";
import { VIZ_FRAME_BUDGET_MS } from "../plugins/viz-host";
import { markPresent, presentTiming, resetPresentClock } from "./present-clock";

describe("present-clock", () => {
  afterEach(() => resetPresentClock());

  it("measures present-to-present interval in ms", () => {
    markPresent(1000);
    markPresent(1029);
    expect(presentTiming()).toEqual({
      presentIntervalMs: 29,
      headroomMs: VIZ_FRAME_BUDGET_MS - 29,
    });
  });
});
