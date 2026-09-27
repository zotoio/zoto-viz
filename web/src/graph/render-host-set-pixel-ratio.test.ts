/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  resetLayoutDevicePxRatioWatch,
} from "../../test-support/layout-device-px-ratio";

const { WebGLRendererMock } = vi.hoisted(() => {
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    private ratio = 1;
    setPixelRatio = vi.fn((n: number) => {
      this.ratio = n;
    });
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

describe("RenderHost setPixelRatio auto-tune", () => {
  let wall: HTMLElement;
  let host: RenderHost;

  beforeEach(() => {
    expect.hasAssertions();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    host = new RenderHost(wall, { software: false, dpr: 1 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
  });

  afterEach(() => {
    host.dispose();
    wall.remove();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("setPixelRatio(1.25) keeps WebGLRenderer pixel ratio at 1 and resizes backing store", () => {
    const rd = host.renderer as THREE.WebGLRenderer;
    host.setPixelRatio(1.25);
    expect(rd.getPixelRatio()).toBe(1);
    expect(rd.setSize).toHaveBeenLastCalledWith(250, 150, false);
  });
});
