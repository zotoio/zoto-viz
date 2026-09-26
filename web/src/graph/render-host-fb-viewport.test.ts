/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { probeLines } from "./pane-change";
import type { GlRect } from "./pack-mirror-rect";
import { RenderHost, type HostedView } from "./render-host";

const { WebGLRendererMock } = vi.hoisted(() => {
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn((w: number, h: number) => {
      this.domElement.width = w;
      this.domElement.height = h;
    });
    setScissorTest = vi.fn();
    setScissor = vi.fn();
    setViewport = vi.fn();
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn();
    getPixelRatio = () => 1;
    getContext = () => ({
      getContextAttributes: () => ({ antialias: false }),
      fenceSync: () => ({}),
      getExtension: () => null,
    });
    forceContextLoss = vi.fn();
    dispose = vi.fn();
  }
  return { WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

/** Bottom-left css pane {x:1,y:58,w:101,h:61} at pr 1.5 (wall 120px, device H 180) as `GlRect`. */
export const EXPECTED_FB_VIEWPORT = { x: 2, y: 87, w: 151, h: 91, __unit: "gl" as const };

describe("RenderHost framebuffer viewport H=241", () => {
  it("bottom-left pane H=241 pr=1.5: viewport matches Three floor(h*pr) with no double Y flip", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 241 });
    wall.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 400, bottom: 241, width: 400, height: 241, x: 0, y: 0, toJSON: () => ({}),
    });
    const pane = document.createElement("div");
    pane.getBoundingClientRect = () => ({
      left: 0, top: 181, right: 200, bottom: 241, width: 200, height: 60, x: 0, y: 181, toJSON: () => ({}),
    });
    wall.appendChild(pane);
    const host = new RenderHost(wall, { software: false, dpr: 1.5 });
    host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
    const bottomView: HostedView = {
      viewEl: pane,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    };
    host.add(bottomView);
    host.advanceFrame(0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vp = host.present(bottomView, 0x0a1020, scene, camera);
    expect(vp).toEqual({ x: 0, y: 0, w: 300, h: 90, __unit: "gl" });
    expect(host.canvas.height).toBe(Math.round(241 * 1.5));
    host.dispose();
    wall.remove();
  });
});

describe("RenderHost framebuffer viewport", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let view: HostedView;

  beforeEach(() => {
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
    host = new RenderHost(wall, { software: false, dpr: 1.5 });
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

  it("present returns per-edge device rect at pr 1.5 bottom-left css (pane-change readPixels uses the same vp)", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const vp = host.present(view, 0x0a1020, scene, camera);
    expect(vp).not.toBeNull();
    expect(vp).toEqual(EXPECTED_FB_VIEWPORT);
    const lines = probeLines(vp! as GlRect, host.canvas.width, host.canvas.height);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.x).toBe(EXPECTED_FB_VIEWPORT.x);
    expect(lines[0]!.y).toBeGreaterThanOrEqual(EXPECTED_FB_VIEWPORT.y);
  });
});
