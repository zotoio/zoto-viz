import { describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { surfaceLetterboxFill } from "./letterbox-fill";

describe("RenderHost sandbox bitmap present", () => {
  it("closes a 1×1 ImageBitmap exactly once after presentBitmapMirror", () => {
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
    mirrorEl.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 60, width: 100, height: 60, x: 0, y: 0, toJSON: () => ({}),
    });
    wall.appendChild(mirrorEl);
    const host = new RenderHost(wall, { software: true });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    host.advanceFrame(0);
    const mirror = {
      viewEl: mirrorEl,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
    let closed = 0;
    Object.defineProperties(bmp, {
      width: { value: 1 },
      height: { value: 1 },
      close: { value: vi.fn(() => { closed += 1; }) },
    });
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    host.presentBitmapMirror(mirror, bmp, fill, 1, "plugin:tiny");
    expect(closed).toBe(1);
    host.dispose();
    wall.remove();
  });
});
