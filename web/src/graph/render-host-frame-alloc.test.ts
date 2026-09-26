/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { WebGLRendererMock } = vi.hoisted(() => {
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn();
    setScissorTest = vi.fn();
    setScissor = vi.fn();
    setViewport = vi.fn();
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn();
    getPixelRatio = () => 1;
    getContext = () => ({ getContextAttributes: () => ({ antialias: false }) });
    forceContextLoss = vi.fn();
    dispose = vi.fn();
  }
  return { WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";
import { renderHostMirrorTelemetry } from "./render-host-telemetry";
import { surfaceLetterboxFill } from "./letterbox-fill";

type MirrorMetaView = HostedView & {
  packCoalesceGroupKey?: string;
  packCoalesceTileCount?: number;
  isPackMirrorPrimary?: boolean;
  packSandboxMirrorPluginId?: string;
};

function layout2x4(wall: HTMLElement): Map<string, HTMLElement> {
  wall.style.width = "400px";
  wall.style.height = "240px";
  Object.defineProperty(wall, "clientWidth", { configurable: true, value: 400 });
  Object.defineProperty(wall, "clientHeight", { configurable: true, value: 240 });
  wall.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 400, bottom: 240, width: 400, height: 240, x: 0, y: 0, toJSON: () => ({}),
  });
  const cols = 2;
  const rows = 4;
  const tw = 200;
  const th = 60;
  const els = new Map<string, HTMLElement>();
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const el = document.createElement("div");
      const id = `t${i}`;
      el.id = id;
      const x = col * tw;
      const y = row * th;
      el.getBoundingClientRect = () => ({
        left: x, top: y, right: x + tw, bottom: y + th, width: tw, height: th, x, y, toJSON: () => ({}),
      });
      wall.appendChild(el);
      els.set(id, el);
      i += 1;
    }
  }
  return els;
}

describe("RenderHost frame allocations", () => {
  let wall: HTMLElement;
  let host: RenderHost;

  beforeEach(() => {
    renderHostMirrorTelemetry.reset();
    wall = document.createElement("div");
    document.body.appendChild(wall);
    const tiles = layout2x4(wall);
    host = new RenderHost(wall, { software: false });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    const primary: MirrorMetaView = {
      viewEl: tiles.get("t0")!,
      packCoalesceGroupKey: "plugin:sandbox",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    const mirror: MirrorMetaView = {
      viewEl: tiles.get("t1")!,
      packCoalesceGroupKey: "plugin:sandbox",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: false,
      packSandboxMirrorPluginId: "plugin:sandbox",
      hostFrame() {
        const bmp = Object.create(ImageBitmap.prototype) as ImageBitmap;
        Object.defineProperties(bmp, {
          width: { value: 32 },
          height: { value: 24 },
          close: { value: vi.fn() },
        });
        host.presentBitmapMirror(this, bmp, surfaceLetterboxFill(0x0a1020, 0.25), 1, "plugin:sandbox");
      },
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

  it("300 frames at 2×4 with sandbox mirror: one scope sync, stable viewBox and viewport", () => {
    const primary: MirrorMetaView = {
      viewEl: wall.querySelector("#t0")!,
      packCoalesceGroupKey: "plugin:sandbox",
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: true,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.advanceFrame(0);
    expect(renderHostMirrorTelemetry.scopeSyncRuns).toBe(1);
    const box = host.viewBox(primary);
    const vp = host.present(primary, 0x0a1020, scene, camera);
    expect(box).not.toBeNull();
    expect(vp).not.toBeNull();
    for (let f = 0; f < 300; f++) {
      host.advanceFrame(f + 1);
      expect(host.viewBox(primary)).toBe(box);
      expect(host.present(primary, 0x0a1020, scene, camera)).toBe(vp);
    }
    expect(renderHostMirrorTelemetry.scopeSyncRuns).toBe(1);
    expect(renderHostMirrorTelemetry.viewSortRuns).toBe(1);
    expect(renderHostMirrorTelemetry.getContextAttributesCalls).toBe(1);
  });
});
