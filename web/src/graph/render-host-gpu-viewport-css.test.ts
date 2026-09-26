/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost, type HostedView } from "./render-host";

const { WebGLRendererMock } = vi.hoisted(() => {
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    private ratio = 1.5;
    setPixelRatio = vi.fn((n: number) => {
      this.ratio = n;
    });
    setClearColor = vi.fn();
    setSize = vi.fn((w: number, h: number) => {
      const pr = this.getPixelRatio();
      this.domElement.width = Math.floor(w * pr);
      this.domElement.height = Math.floor(h * pr);
    });
    setScissorTest = vi.fn();
    setScissor = vi.fn();
    setViewport = vi.fn();
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn();
    getPixelRatio = () => this.ratio;
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

function mountGpuViewportFixture(dpr: number | "window"): {
  wall: HTMLElement;
  host: RenderHost;
  view: HostedView;
} {
  const wall = document.createElement("div");
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
  const host =
    dpr === "window"
      ? new RenderHost(wall, { software: false })
      : new RenderHost(wall, { software: false, dpr });
  host.canvas.getBoundingClientRect = () => wall.getBoundingClientRect();
  const view: HostedView = {
    viewEl: pane,
    hostFrame() {},
    hostContextLost() {},
    hostContextRestored() {},
  };
  host.add(view);
  host.advanceFrame(0);
  return { wall, host, view };
}

describe("RenderHost GPU viewport units", () => {
  let wall: HTMLElement;
  let host: RenderHost;
  let view: HostedView;

  afterEach(() => {
    host?.dispose();
    wall?.remove();
    vi.unstubAllGlobals();
  });

  it("present passes CSS pixels to Three setViewport and setScissor at pr 1.5", () => {
    ({ wall, host, view } = mountGpuViewportFixture(1.5));
    const rd = host.renderer as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.present(view, 0x0a1020, scene, camera);
    expect(rd.setViewport).toHaveBeenCalledWith(1, 58, 101, 61);
    expect(rd.setScissor).toHaveBeenCalledWith(1, 58, 101, 61);
  });

  it("present passes CSS pixels to Three setViewport and setScissor when devicePixelRatio is 2 and renderer pr is capped at 1.5", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    ({ wall, host, view } = mountGpuViewportFixture("window"));
    expect(host.pixelRatio).toBe(1.5);
    const rd = host.renderer as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.present(view, 0x0a1020, scene, camera);
    expect(rd.setViewport).toHaveBeenCalledWith(1, 58, 101, 61);
    expect(rd.setScissor).toHaveBeenCalledWith(1, 58, 101, 61);
  });
});
