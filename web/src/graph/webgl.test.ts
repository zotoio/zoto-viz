import { describe, expect, it } from "vitest";
import { probeWebGL } from "./webgl";
import { RenderHost } from "./render-host";

describe("probeWebGL", () => {
  it("is false under happy-dom (no GPU)", () => {
    expect(probeWebGL()).toBe(false);
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
