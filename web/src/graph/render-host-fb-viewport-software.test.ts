/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";

describe("RenderHost software framebuffer viewport", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let view: HostedView;

  beforeEach(() => {
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 240 });
    wall.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 400, bottom: 240, width: 400, height: 240, x: 0, y: 0, toJSON: () => ({}),
    });
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    pane.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 200, bottom: 60, width: 200, height: 60, x: 0, y: 0, toJSON: () => ({}),
    });
    wall.appendChild(pane);
    host = new RenderHost(wall, { software: true, dpr: 1.5 });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    view = {
      viewEl: pane,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(view);
    host.advanceFrame(0);
  });

  afterEach(() => {
    host.dispose();
    wall.remove();
  });

  it("2×4 top-left tile0 at pr 1.5: CanvasChangeProbe rect y=0 (no GL Y flip on software path)", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vp = host.present(view, 0x0a1020, scene, camera);
    expect(vp).not.toBeNull();
    expect(vp!.y).toBe(0);
    expect(vp!.x).toBe(0);
    expect(vp!.w).toBe(300);
    expect(vp!.h).toBe(90);
  });
});
