/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  resetLayoutDevicePxRatioWatch,
} from "../../test-support/layout-device-px-ratio";

const dprMedia = vi.hoisted(() => {
  let dpr = 2;
  return {
    get dpr() {
      return dpr;
    },
    set dpr(n: number) {
      dpr = n;
    },
    matchMedia: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  };
});

describe("layout DPR matchMedia re-arm (raw window DPR)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
    dprMedia.dpr = 2;
    dprMedia.matchMedia.mockClear();
    vi.stubGlobal("matchMedia", dprMedia.matchMedia);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      get: () => dprMedia.dpr,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    resetLayoutDevicePxRatioWatch();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("arms resolution media query at raw 2dppx while layout DPR stays capped at 1.5", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    const queries = dprMedia.matchMedia.mock.calls.map((c) => c[0] as string);
    expect(queries.some((q) => q === "(resolution: 2dppx)")).toBe(true);
    expect(queries.some((q) => q === "(resolution: 1.5dppx)")).toBe(false);
    expect(host.pixelRatio).toBe(1.5);
    host.dispose();
  });
});
