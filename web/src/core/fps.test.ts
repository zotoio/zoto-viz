import { afterEach, describe, expect, it, vi } from "vitest";
import { bindFps, bindPresentListener, markFrame, resetFps } from "./fps";

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
});
