import { describe, expect, it } from "vitest";
import {
  asCanvasDeviceHeight,
  asCssRect,
  cssRect,
  deviceSizeFromCssBoxInto,
  toDeviceRectInto,
  toGlRectInto,
  type CssRectLoose,
  type DeviceRectMut,
  type DeviceSizeMut,
  type GlRectMut,
} from "./pack-mirror-rect";

describe("pack-mirror rect converters", () => {
  it("deviceSizeFromCssBoxInto: non-finite w clamps to 2×2 device RT", () => {
    const out: DeviceSizeMut = { pw: 0, ph: 0 };
    deviceSizeFromCssBoxInto({ x: 0, y: 0, w: Number.NaN, h: 48 }, 1, out);
    expect(out).toEqual({ pw: 2, ph: 48 });
    deviceSizeFromCssBoxInto({ w: 64, h: 48 } as CssRectLoose, 1, out);
    expect(out).toEqual({ pw: 64, ph: 48 });
  });

  it("tile-edge-shared: adjacent tiles share device x (and y) at pr 1.5", () => {
    const a = cssRect(0, 0, 101, 40);
    const b = cssRect(101, 0, 99, 40);
    const aOut: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    const bOut: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    toDeviceRectInto(a, 1.5, aOut);
    toDeviceRectInto(b, 1.5, bOut);
    expect(aOut.x + aOut.w).toBe(bOut.x);
    expect(aOut.y).toBe(bOut.y);
    expect(aOut.h).toBe(bOut.h);
    expect(aOut.x).toBe(0);
    expect(aOut.w).toBe(152);
    expect(bOut.x).toBe(152);

    const low = cssRect(0, 0, 60, 41);
    const high = cssRect(0, 41, 60, 37);
    const lowOut: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    const highOut: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    toDeviceRectInto(low, 1.5, lowOut);
    toDeviceRectInto(high, 1.5, highOut);
    expect(lowOut.y + lowOut.h).toBe(highOut.y);
  });

  it("toGlRectInto: top-left device to GL bottom-left using canvas.height only", () => {
    const dev = { x: 2, y: 2, w: 151, h: 91, __unit: "device" as const };
    const glOut: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };
    toGlRectInto(dev, asCanvasDeviceHeight(180), glOut);
    expect(glOut).toEqual({ x: 2, y: 87, w: 151, h: 91, __unit: "gl" });
  });
});

void asCssRect;
