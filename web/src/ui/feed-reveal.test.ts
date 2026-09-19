import { describe, expect, it } from "vitest";
import { FEED_REVEAL_CPS, FEED_SCROLL_PPS, followScrollTop, revealStep } from "./feed-reveal";

describe("revealStep", () => {
  it("holds until there is a budget, then prefers a word break", () => {
    expect(revealStep("hello world", "", 0, FEED_REVEAL_CPS)).toBe("h");
    expect(revealStep("hello world", "", 0.3, 20)).toBe("hello ");
    expect(revealStep("hello world", "hello ", 1, 20)).toBe("hello world");
  });

  it("restarts when the buffer is not a prefix of the target", () => {
    expect(revealStep("new text", "thinking…", 1, 80)).toBe("new text");
  });
});

describe("followScrollTop", () => {
  it("scrolls a queued backlog at a capped speed instead of snapping", () => {
    expect(followScrollTop(0, 2000, 80, 0.016)).toBeCloseTo(FEED_SCROLL_PPS * 0.016);
    const next = followScrollTop(300, 400, 80, 0.016);
    expect(next).toBeGreaterThan(300);
    expect(next).toBeLessThan(320);
    expect(followScrollTop(319.8, 400, 80, 0.016)).toBe(320);
  });

  it("does not move a zero-height ticker", () => {
    expect(followScrollTop(0, 400, 0, 0.016)).toBe(0);
  });
});
