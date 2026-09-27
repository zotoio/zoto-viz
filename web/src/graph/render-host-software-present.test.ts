/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";
import { isDeviceRect } from "./pack-mirror-rect";
describe("RenderHost software present", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let view: HostedView;

  beforeEach(() => {
    expect.hasAssertions();
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    wall.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
    });
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    pane.getBoundingClientRect = () => ({
      left: 1, top: 1, right: 102, bottom: 62, width: 101, height: 61, x: 1, y: 1, toJSON: () => ({}),
    });
    wall.appendChild(pane);
    host = new RenderHost(wall, { software: true, dpr: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    view = {
      viewEl: pane,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(view);
  });

  afterEach(() => {
    host.dispose();
    wall.remove();
  });

  it("present returns a branded DeviceRect on the software path", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vp = host.present(view, 0x0a1020, scene, camera);
    expect(vp).not.toBeNull();
    expect(isDeviceRect(vp!)).toBe(true);
  });
});
