import { describe, expect, it } from "vitest";
import { ignoreResizeLoopError, observeResize } from "./resize";

describe("observeResize", () => {
  it("attaches a ResizeObserver without throwing", () => {
    const el = document.createElement("div");
    const ro = observeResize(el, () => {});
    expect(ro).toBeInstanceOf(ResizeObserver);
    ro!.disconnect();
  });
});

describe("ignoreResizeLoopError", () => {
  it("swallows the Chrome ResizeObserver loop error", () => {
    ignoreResizeLoopError();
    const ev = new ErrorEvent("error", {
      message: "ResizeObserver loop completed with undelivered notifications.",
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
