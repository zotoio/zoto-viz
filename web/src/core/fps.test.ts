import { afterEach, describe, expect, it, vi } from "vitest";
import { addPresentListener, bindFps, bindPresentListener, markFrame, PaneFps, resetFps } from "./fps";
import { monoMs } from "./time-ms";

describe("markFrame", () => {
  afterEach(() => resetFps());

  it("does not count the same timestamp twice", () => {
    const el = document.createElement("span");
    bindFps(el);
    markFrame(monoMs(0));
    markFrame(monoMs(0));
    markFrame(monoMs(500));
    markFrame(monoMs(1000));
    expect(el.textContent).toBe("2");
    markFrame(monoMs(1100));
    expect(el.textContent).toBeTruthy();
  });

  it("notifies the present listener once per unique vsync", () => {
    const onPresent = vi.fn();
    bindPresentListener(onPresent);
    markFrame(monoMs(0));
    markFrame(monoMs(0));
    markFrame(monoMs(16.7));
    markFrame(monoMs(33.4));
    expect(onPresent).toHaveBeenCalledTimes(3);
    expect(onPresent).toHaveBeenLastCalledWith(33.4);
  });

  it("present listener fan-out: two listeners both fire on one vsync", () => {
    const a = vi.fn();
    const b = vi.fn();
    addPresentListener(a);
    addPresentListener(b);
    markFrame(monoMs(42));
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
    markFrame(monoMs(100));
    markFrame(monoMs(120));
    expect(keep).toHaveBeenCalledTimes(2);
    expect(drop).not.toHaveBeenCalled();
  });
});

describe("PaneFps", () => {
  it("counts picture changes in one pane, and falls to zero when the picture stops changing", () => {
    const host = document.createElement("div");
    const pane = new PaneFps(host);
    expect(host.querySelector(".pane-fps")).toBe(pane.el);
    pane.mark(0);
    pane.mark(100);
    pane.mark(200);
    expect(pane.el.textContent).toBe("10 fps");
    pane.noteGpu(200);
    expect(pane.el.textContent).toBe("10 fps");
    pane.tick(2000);
    expect(pane.el.textContent).toBe("0 fps");
    pane.dispose();
    expect(host.querySelector(".pane-fps")).toBeNull();
  });
});
