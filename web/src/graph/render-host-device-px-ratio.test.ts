/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_DEVICE_PX_RATIO,
  MAX_DEVICE_PX_RATIO,
  configureLayoutMaxDevicePxRatio,
  devicePxRatioFromNumber,
  devicePxRatioFromWindow,
  devicePxRatioNumber,
} from "./render-host-device-px-ratio";

describe("render-host device px ratio mint", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    configureLayoutMaxDevicePxRatio(DEFAULT_MAX_DEVICE_PX_RATIO);
  });

  it("caps window devicePixelRatio at 1.5", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    expect(devicePxRatioNumber(devicePxRatioFromWindow())).toBe(MAX_DEVICE_PX_RATIO);
  });

  it("uses 1 when window.devicePixelRatio is missing", () => {
    vi.stubGlobal("devicePixelRatio", Number.NaN);
    expect(devicePxRatioNumber(devicePxRatioFromWindow())).toBe(1);
  });

  it("clamps explicit numbers into (0.01, 1.5]", () => {
    expect(devicePxRatioNumber(devicePxRatioFromNumber(0))).toBe(0.01);
    expect(devicePxRatioNumber(devicePxRatioFromNumber(9))).toBe(MAX_DEVICE_PX_RATIO);
  });

  it("honors configureLayoutMaxDevicePxRatio from RenderHost", () => {
    configureLayoutMaxDevicePxRatio(1.25);
    vi.stubGlobal("devicePixelRatio", 2);
    expect(devicePxRatioNumber(devicePxRatioFromWindow())).toBe(1.25);
  });
});
