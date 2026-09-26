/** @vitest-environment happy-dom */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RenderHost, type HostedView } from "./render-host";
import { renderHostMirrorTelemetry } from "./render-host-telemetry";

function layoutWall(
  wall: HTMLElement,
  boxes: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): void {
  wall.style.width = "200px";
  wall.style.height = "120px";
  Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
  Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
  wall.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON: () => ({}),
  });
  for (const b of boxes) {
    const el = document.createElement("div");
    el.id = b.id;
    el.getBoundingClientRect = () => ({
      left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h, width: b.w, height: b.h, x: b.x, y: b.y, toJSON: () => ({}),
    });
    wall.appendChild(el);
  }
}

type MirrorMetaView = HostedView & {
  packCoalesceGroupKey?: string;
  packCoalesceTileCount?: number;
  isPackMirrorPrimary?: boolean;
};

describe("RenderHost mirror frame loop", () => {
  let wall: HTMLElement;
  let host: RenderHost;

  beforeEach(() => {
    renderHostMirrorTelemetry.reset();
    wall = document.createElement("div");
    document.body.appendChild(wall);
    layoutWall(wall, [
      { id: "primary", x: 0, y: 0, w: 100, h: 80 },
      { id: "mirror", x: 100, y: 0, w: 90, h: 70 },
    ]);
    host = new RenderHost(wall, { software: true });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    const primary: MirrorMetaView = {
      viewEl: document.getElementById("primary")!,
      packCoalesceGroupKey: "plugin:dup",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    const mirror: MirrorMetaView = {
      viewEl: document.getElementById("mirror")!,
      packCoalesceGroupKey: "plugin:dup",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: false,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(primary);
    host.add(mirror);
  });

  afterEach(() => {
    host.dispose();
    wall.remove();
    renderHostMirrorTelemetry.reset();
  });

  it("300 frames without layout change: one scope sync, zero sorts, stable viewport instance", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const primary: MirrorMetaView = {
      viewEl: document.getElementById("primary")!,
      packCoalesceGroupKey: "plugin:dup",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.advanceFrame(0);
    expect(renderHostMirrorTelemetry.scopeSyncRuns).toBe(1);
    expect(renderHostMirrorTelemetry.viewSortRuns).toBe(1);
    const lastVp = host.present(primary, 0x0a1020, scene, camera);
    expect(lastVp).not.toBeNull();
    for (let i = 0; i < 300; i++) {
      host.advanceFrame(i + 1);
      const vp = host.present(primary, 0x0a1020, scene, camera);
      expect(vp).toBe(lastVp);
    }
    expect(renderHostMirrorTelemetry.scopeSyncRuns).toBe(1);
    expect(renderHostMirrorTelemetry.viewSortRuns).toBe(1);
  });
});
