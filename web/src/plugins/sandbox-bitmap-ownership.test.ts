/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "../graph/render-host";
import { surfaceLetterboxFill } from "../graph/letterbox-fill";
import { SandboxBitmapLane, resetSandboxBitmapLanes } from "./sandbox-bitmap";

function mockBitmap(): ImageBitmap {
  const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
  Object.defineProperties(bmp, {
    width: { value: 32 },
    height: { value: 24 },
    close: { value: vi.fn() },
  });
  return bmp;
}

function layoutWall(): { wall: HTMLElement; mirrorEl: HTMLElement; host: RenderHost } {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
  Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
  wall.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
  });
  document.body.appendChild(wall);
  const mirrorEl = document.createElement("div");
  mirrorEl.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80, x: 0, y: 0, toJSON: () => ({}),
  });
  wall.appendChild(mirrorEl);
  const host = new RenderHost(wall, { software: true });
  host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
  host.advanceFrame(0);
  return { wall, mirrorEl, host };
}

describe("SandboxBitmapLane bitmap ownership", () => {
  afterEach(() => {
    resetSandboxBitmapLanes();
    document.body.innerHTML = "";
  });

  it("closed equals created on sub-2px guard and on normal present (one close each)", () => {
    const { wall, mirrorEl, host } = layoutWall();
    const lane = new SandboxBitmapLane("plugin:own");
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    const mirror = {
      viewEl: mirrorEl,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };

    const tiny = mockBitmap();
    lane.ingest(tiny, lane.generation);
    const tinyEl = document.createElement("div");
    tinyEl.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1, x: 0, y: 0, toJSON: () => ({}),
    });
    wall.appendChild(tinyEl);
    const tinyMirror = { viewEl: tinyEl, hostFrame() {}, hostContextLost() {}, hostContextRestored() {} };
    lane.drawMirror(host, tinyMirror, fill, 1);
    expect(tiny.close).toHaveBeenCalledTimes(1);
    expect(lane.stats.closed).toBe(1);
    expect(lane.stats.received).toBe(1);

    const normal = mockBitmap();
    lane.ingest(normal, lane.generation);
    lane.drawMirror(host, mirror, fill, 1);
    expect(normal.close).toHaveBeenCalledTimes(1);
    expect(lane.stats.closed).toBe(2);
    expect(lane.stats.received).toBe(2);
    expect(lane.stats.closed).toBe(lane.stats.received);

    host.dispose();
    wall.remove();
  });
});
