import { describe, expect, it, vi } from "vitest";
import { probeWebGL } from "./webgl";
import { RenderHost } from "./render-host";

describe("probeWebGL", () => {
  it("is false under happy-dom (no GPU)", () => {
    expect(probeWebGL()).toBe(false);
  });

  it("releases the probe context so it does not count against Chrome's context cap", () => {
    const lose = vi.fn();
    const gl = {
      VENDOR: 0x1f00,
      RENDERER: 0x1f01,
      getParameter: () => "NVIDIA",
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (String(type).includes("webgl")) return gl as never;
      return orig.call(this, type as never);
    } as typeof orig;
    try {
      expect(probeWebGL()).toBe(true);
      expect(lose).toHaveBeenCalledOnce();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
  });
});

describe("RenderHost software fallback", () => {
  it("boots a 2d canvas when WebGL is missing", () => {
    const wall = document.createElement("div");
    wall.style.width = "200px";
    wall.style.height = "100px";
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    expect(host.software).toBe(true);
    expect(host.renderer.getContext()).toBeNull();
    expect(wall.querySelector("canvas.render-host")).toBeTruthy();
    expect(host.gl).toBeNull();
    host.dispose();
    wall.remove();
  });

  it("clips a software present into the view box", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const box = { x: 0, y: 0, width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100, toJSON() { return this; } };
    wall.getBoundingClientRect = () => box as DOMRect;
    pane.getBoundingClientRect = () => box as DOMRect;
    const host = new RenderHost(wall, { software: true });
    host.canvas.getBoundingClientRect = () => box as DOMRect;
    Object.defineProperty(wall, "clientWidth", { value: 200 });
    Object.defineProperty(wall, "clientHeight", { value: 100 });
    let painted = 0;
    const view = {
      viewEl: pane,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
      paintSoftware() { painted++; },
    };
    const vp = host.present(view, 0x112233, {} as never, {} as never);
    if (host.canvas.getContext("2d")) expect(painted).toBe(1);
    expect(vp).not.toBeNull();
    host.dispose();
    wall.remove();
  });
});
