/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  devicePxRatioFromNumber,
  devicePxRatioNumber,
  layoutDevicePxRatio,
} from "../../test-support/layout-device-px-ratio";

describe("render-host device px ratio mint", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("caps window devicePixelRatio at 1.5 via RenderHost watch", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    expect(devicePxRatioNumber(layoutDevicePxRatio())).toBe(DEFAULT_MAX_DEVICE_PX_RATIO);
    host.dispose();
  });

  it("uses 1 when window.devicePixelRatio is not a number", () => {
    vi.stubGlobal("devicePixelRatio", "x" as unknown as number);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    expect(devicePxRatioNumber(layoutDevicePxRatio())).toBe(1);
    host.dispose();
  });

  it("clamps explicit numbers into (0.01, 1.5]", () => {
    expect(devicePxRatioNumber(devicePxRatioFromNumber(0))).toBe(0.01);
    expect(devicePxRatioNumber(devicePxRatioFromNumber(9))).toBe(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("honors maxLayoutDevicePxRatio from RenderHost", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(wall, "clientHeight", { configurable: true, value: 120 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true, maxLayoutDevicePxRatio: 1.25 });
    cancelAnimationFrame((host as unknown as { raf: number }).raf);
    expect(host.pixelRatio).toBe(1.25);
    host.dispose();
  });
});
