import { describe, expect, it } from "vitest";
import {
  asCssRect,
  cssRect,
  toDeviceRectInto,
  type DeviceRectMut,
} from "./pack-mirror-rect";

/** Stated drawing-buffer height for rect converter rows (CSS canvas 120px × pr 1.5). */
const CANVAS_DEVICE_HEIGHT = 180;

const EXPECTED_VIEWPORT_CAPTURE = { x: 2, y: 87, w: 151, h: 91 };

describe("pack-mirror rect converters", () => {
  it("capture-equals-viewport: readback device rect matches viewport at pr 1.5", () => {
    const r = cssRect(1, 1, 101, 61);
    const viewport: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    const capture: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    toDeviceRectInto(r, 1.5, CANVAS_DEVICE_HEIGHT, viewport);
    toDeviceRectInto(r, 1.5, CANVAS_DEVICE_HEIGHT, capture);
    expect(capture).toEqual(viewport);
    expect(viewport).toEqual(EXPECTED_VIEWPORT_CAPTURE);
  });

  it("tile-edge-shared: adjacent tiles share device x (and y) at pr 1.5", () => {
    const a = cssRect(0, 0, 101, 40);
    const b = cssRect(101, 0, 99, 40);
    const aOut: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    const bOut: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    toDeviceRectInto(a, 1.5, CANVAS_DEVICE_HEIGHT, aOut);
    toDeviceRectInto(b, 1.5, CANVAS_DEVICE_HEIGHT, bOut);
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
    toDeviceRectInto(low, 1.5, CANVAS_DEVICE_HEIGHT, lowOut);
    toDeviceRectInto(high, 1.5, CANVAS_DEVICE_HEIGHT, highOut);
    expect(lowOut.y).toBe(highOut.y + highOut.h);
  });
});

void asCssRect;
