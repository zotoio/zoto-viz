import { afterEach, describe, expect, it } from "vitest";
import { markPresent, presentInterval, resetPresentClock } from "./present-clock";

describe("present-clock", () => {
  afterEach(() => resetPresentClock());

  it("measures present-to-present interval in ms", () => {
    markPresent(1000);
    markPresent(1029);
    expect(presentInterval()).toBe(29);
  });
});
