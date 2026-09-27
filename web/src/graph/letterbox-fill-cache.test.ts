/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSurfaceLetterboxFill,
  letterboxFillStats,
} from "./letterbox-fill";
import { clearSurfaceLetterboxFillCache } from "../../test-support/letterbox-fill-cache";

describe("surface letterbox fill cache", () => {
  beforeEach(() => {
    expect.hasAssertions();
    clearSurfaceLetterboxFillCache();
    letterboxFillStats.reset();
  });

  afterEach(() => {
    clearSurfaceLetterboxFillCache();
    letterboxFillStats.reset();
  });

  it("300 frames: same fill instance, 0 regex match, 1 rebuild after theme clearHex change", () => {
    const matchSpy = vi.spyOn(String.prototype, "match");
    const a = getSurfaceLetterboxFill(0x0b0e14, 0.25);
    for (let i = 0; i < 300; i++) {
      const fill = getSurfaceLetterboxFill(0x0b0e14, 0.25);
      expect(fill).toBe(a);
    }
    expect(letterboxFillStats.rebuilds).toBe(1);
    expect(matchSpy.mock.calls.length).toBe(0);
    const b = getSurfaceLetterboxFill(0x112233, 0.25);
    expect(b).not.toBe(a);
    expect(letterboxFillStats.rebuilds).toBe(2);
    matchSpy.mockRestore();
  });
});
