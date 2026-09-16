import { afterEach, describe, expect, it } from "vitest";
import { bindFps, markFrame, resetFps } from "./fps";

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
});
