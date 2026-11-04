import { describe, expect, it, vi } from "vitest";
import { ContextLossLimiter, FrameGate, ViewErrorBudget } from "./frame-guard";

describe("ViewErrorBudget", () => {
  it("logs the first throw of a streak, disables after the budget, keeps other views drawing", () => {
    const onDisable = vi.fn(); const onError = vi.fn();
    const b = new ViewErrorBudget<object>(3, onDisable, onError);
    const bad = {}; const good = {}; let goodFrames = 0;
    for (let i = 0; i < 10; i++) {
      b.run(bad, () => { throw new TypeError("x"); });
      b.run(good, () => { goodFrames++; });
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(b.isDisabled(bad)).toBe(true);
    expect(goodFrames).toBe(10);
    b.reenable();
    expect(b.run(bad, () => undefined)).toBe(true);
  });
  it("a good frame resets the streak", () => {
    const onDisable = vi.fn();
    const b = new ViewErrorBudget<object>(3, onDisable);
    const v = {};
    for (let i = 0; i < 10; i++) {
      b.run(v, () => { throw new Error(); });
      b.run(v, () => { throw new Error(); });
      b.run(v, () => undefined);
    }
    expect(onDisable).not.toHaveBeenCalled();
  });
});

describe("FrameGate", () => {
  it("uncapped draws every frame; 30 fps on a 60 Hz display draws every other frame", () => {
    const g = new FrameGate(0);
    expect([0, 16.7, 33.3].every((t) => g.shouldDraw(t))).toBe(true);
    const c = new FrameGate(30);
    const drawn = Array.from({ length: 60 }, (_, i) => c.shouldDraw(i * 16.667)).filter(Boolean).length;
    expect(drawn).toBeGreaterThanOrEqual(29);
    expect(drawn).toBeLessThanOrEqual(31);
  });
});

describe("ContextLossLimiter", () => {
  it("trips once when losses within the window reach the limit", () => {
    const l = new ContextLossLimiter(3, 600_000);
    expect(l.note(0)).toBe(false);
    expect(l.note(700_000)).toBe(false); // first one aged out
    expect(l.note(800_000)).toBe(false);
    expect(l.note(900_000)).toBe(true);
    expect(l.note(901_000)).toBe(false);
    expect(l.isTripped).toBe(true);
  });
});
