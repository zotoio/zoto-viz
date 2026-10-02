/** #255: a fitting couldn't-draw line leaves the wheel to the camera. An overflowing line keeps it. */
import { describe, expect, it } from "vitest";
import { inScrollingCantDrawLine } from "./scene";

function line(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "tile-cant-draw";
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  document.body.appendChild(el);
  return el;
}

describe("#255 solo couldn't-draw wheel", () => {
  it("a fitting line does not take the wheel, and an overflowing line does, even at the bottom", () => {
    const fit = line(40, 40);
    expect(inScrollingCantDrawLine(fit)).toBe(false);
    const over = line(200, 40);
    over.scrollTop = over.scrollHeight;
    expect(inScrollingCantDrawLine(over)).toBe(true);
    const child = document.createElement("span");
    over.appendChild(child);
    expect(inScrollingCantDrawLine(child)).toBe(true);
  });
});
