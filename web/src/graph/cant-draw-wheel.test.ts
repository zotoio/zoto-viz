/**
 * A fitting couldn't-draw line leaves the wheel to the camera. An overflowing scrolling line keeps
 * it. A line that is not the scrolling box (mosaic: overflow stays visible) never takes the wheel,
 * even when its text is taller than the box.
 */
import { describe, expect, it } from "vitest";
import { inScrollingCantDrawLine } from "./scene";

function line(scrollHeight: number, clientHeight: number, scrolls: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = "tile-cant-draw";
  if (scrolls) el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  document.body.appendChild(el);
  return el;
}

describe("solo couldn't-draw wheel", () => {
  it("a fitting line does not take the wheel, and an overflowing scrolling line does, even at the bottom", () => {
    const fit = line(40, 40, true);
    expect(inScrollingCantDrawLine(fit)).toBe(false);
    const over = line(200, 40, true);
    over.scrollTop = over.scrollHeight;
    expect(inScrollingCantDrawLine(over)).toBe(true);
    const child = document.createElement("span");
    over.appendChild(child);
    expect(inScrollingCantDrawLine(child)).toBe(true);
    const mosaic = line(200, 40, false);
    expect(inScrollingCantDrawLine(mosaic), "a non-scrolling line leaves the wheel").toBe(false);
  });
});
