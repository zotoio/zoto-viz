import { afterEach, describe, expect, it, vi } from "vitest";
import { addPresentListener, bindFps, bindPresentListener, markFrame, resetFps } from "./fps";

describe("markFrame", () => {
  afterEach(() => resetFps());

  it("does not count the same timestamp twice", () => {
    const el = document.createElement("span");
    bindFps(el);
    markFrame(0);
    markFrame(0);
    markFrame(500);
    markFrame(1000);
    expect(el.textContent).toBe("2");
    markFrame(1100);
    expect(el.textContent).toBeTruthy();
  });

  it("notifies the present listener once per unique vsync", () => {
    const onPresent = vi.fn();
    bindPresentListener(onPresent);
    markFrame(0);
    markFrame(0);
    markFrame(16.7);
    markFrame(33.4);
    expect(onPresent).toHaveBeenCalledTimes(3);
    expect(onPresent).toHaveBeenLastCalledWith(33.4);
  });

  it("present listener fan-out: two listeners both fire on one vsync", () => {
    const a = vi.fn();
    const b = vi.fn();
    addPresentListener(a);
    addPresentListener(b);
    markFrame(42);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it("present listener fan-out: unsubscribing one does not silence the other", () => {
    const keep = vi.fn();
    const drop = vi.fn();
    addPresentListener(keep);
    const unsub = addPresentListener(drop);
    unsub();
    markFrame(100);
    markFrame(120);
    expect(keep).toHaveBeenCalledTimes(2);
    expect(drop).not.toHaveBeenCalled();
  });
});
