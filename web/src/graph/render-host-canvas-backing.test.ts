/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";

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

describe("RenderHost canvas backing store", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    expect.hasAssertions();
  });

  it("resizeGpuCanvas uses Math.max(1, …) for zero CSS wall size", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: false, dpr: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    (host as unknown as { w: number }).w = 0;
    (host as unknown as { h: number }).h = 0;
    (host as unknown as { resizeGpuCanvas(): void }).resizeGpuCanvas();
    expect(host.canvas.width).toBe(1);
    expect(host.canvas.height).toBe(1);
    host.dispose();
  });

  it("constructor refreshCanvasDeviceHeight matches canvas.height when syncSize skips tiny walls", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 1 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 1 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: false, dpr: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    const branded = (host as unknown as { canvasDeviceHeight: number }).canvasDeviceHeight;
    expect(branded).toBe(host.canvas.height);
    host.dispose();
  });

  it("refreshCanvasDeviceHeight uses Math.max(1, canvas.height)", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: false, dpr: 1.5 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    host.canvas.height = 0;
    (host as unknown as { refreshCanvasDeviceHeight(): void }).refreshCanvasDeviceHeight();
    expect((host as unknown as { canvasDeviceHeight: number }).canvasDeviceHeight).toBe(1);
    host.dispose();
  });
});
