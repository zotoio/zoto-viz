/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DEVICE_PX_RATIO,
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
});
