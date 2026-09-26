/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { surfaceLetterboxFill } from "./letterbox-fill";

describe("RenderHost mirror tile shrink", () => {
  it("closes bitmap once when mirror tile shrinks to 1px during advanceFrame", () => {
    const wall = document.createElement("div");
    wall.style.width = "120px";
    wall.style.height = "80px";
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 120 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 80 });
    wall.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 120, bottom: 80, width: 120, height: 80, x: 0, y: 0, toJSON: () => ({}),
    });
    document.body.appendChild(wall);
    const mirrorEl = document.createElement("div");
    let w = 100;
    let h = 60;
    mirrorEl.getBoundingClientRect = () => ({
      left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}),
    });
    wall.appendChild(mirrorEl);
    const host = new RenderHost(wall, { software: true });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    const mirror = {
      viewEl: mirrorEl,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
    let closed = 0;
    Object.defineProperties(bmp, {
      width: { value: 32 },
      height: { value: 24 },
      close: { value: vi.fn(() => { closed += 1; }) },
    });
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    host.advanceFrame(0);
    w = 1;
    h = 1;
    host.presentBitmapMirror(mirror, bmp, fill, 1, "plugin:shrink");
    expect(closed).toBe(1);
    host.dispose();
    wall.remove();
  });
});
