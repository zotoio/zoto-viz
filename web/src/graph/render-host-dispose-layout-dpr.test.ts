/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  resetLayoutDevicePxRatioWatch,
} from "../../test-support/layout-device-px-ratio";

const dprMedia = vi.hoisted(() => {
  let dpr = 1;
  let onChange: (() => void) | null = null;
  return {
    get dpr() {
      return dpr;
    },
    set dpr(n: number) {
      dpr = n;
    },
    matchMedia: vi.fn(() => ({
      matches: false,
      media: "",
      addEventListener: (_t: string, fn: () => void) => {
        onChange = fn;
      },
      removeEventListener: (_t: string, fn: () => void) => {
        if (onChange === fn) onChange = null;
      },
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
    fireChange() {
      onChange?.();
    },
  };
});

const { hostSetSizeLog, WebGLRendererMock } = vi.hoisted(() => {
  const hostSetSizeLog = { calls: 0 };
  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn(() => {
      hostSetSizeLog.calls += 1;
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
  return { hostSetSizeLog, WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

describe("RenderHost dispose layout DPR listener", () => {
  let wall: HTMLElement;

  beforeEach(() => {
    expect.hasAssertions();
    hostSetSizeLog.calls = 0;
    dprMedia.dpr = 1;
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
    vi.stubGlobal("matchMedia", dprMedia.matchMedia);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      get: () => dprMedia.dpr,
    });
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
  });

  afterEach(() => {
    wall.remove();
    vi.unstubAllGlobals();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("after dispose, window DPR change does not resize the host canvas", () => {
    const host = new RenderHost(wall, { software: false });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    hostSetSizeLog.calls = 0;
    host.dispose();
    dprMedia.dpr = 2;
    dprMedia.fireChange();
    expect(hostSetSizeLog.calls).toBe(0);
  });
});
