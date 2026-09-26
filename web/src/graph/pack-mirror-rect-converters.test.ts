import { describe, expect, it } from "vitest";
import {
  asCssRect,
  cssRect,
  toDeviceCaptureRectInto,
  toDeviceRectInto,
  type DeviceRectMut,
} from "./pack-mirror-rect";

const out: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };

/** Stated drawing-buffer height for rect converter rows (CSS canvas 120px × pr 1.5). */
const CANVAS_DEVICE_HEIGHT = 180;

describe("pack-mirror rect converters", () => {
  it("capture-rounding: floor/ceil edges at pr 1.5 (revert row: per-field round → x=2)", () => {
    const r = cssRect(1, 1, 101, 61);
    toDeviceCaptureRectInto(r, 1.5, CANVAS_DEVICE_HEIGHT, out);
    expect(out.x).toBe(1);
    expect(out.w).toBe(152);
    expect(out.h).toBe(92);
    expect(out.y).toBe(87);
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

  it("viewport vs capture: same css box, capture is at least as wide", () => {
    const r = cssRect(1, 1, 101, 61);
    const vp: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
    toDeviceRectInto(r, 1.5, CANVAS_DEVICE_HEIGHT, vp);
    toDeviceCaptureRectInto(r, 1.5, CANVAS_DEVICE_HEIGHT, out);
    expect(out.w).toBeGreaterThanOrEqual(vp.w);
    expect(out.x).toBeLessThanOrEqual(vp.x);
  });
});

/** Revert-proof expectations documented for REPORT (unpatched lines above). */
export const PACK_MIRROR_RECT_ASSERTION_LINES = {
  "capture-rounding": {
    file: "src/graph/pack-mirror-rect-converters.test.ts",
    unpatched: [
      "expect(out.x).toBe(1);",
      "expect(out.w).toBe(152);",
      "expect(out.h).toBe(92);",
      "expect(out.y).toBe(87);",
    ],
    patchedFailsOn: "expect(out.x).toBe(1); // receives 2 when capture uses per-field Math.round",
  },
  "tile-edge-shared": {
    file: "src/graph/pack-mirror-rect-converters.test.ts",
    unpatched: [
      "expect(aOut.x + aOut.w).toBe(bOut.x);",
      "expect(lowOut.y).toBe(highOut.y + highOut.h);",
    ],
    patchedFailsOn: "expect(aOut.x + aOut.w).toBe(bOut.x); // 1px overlap when viewport uses floor/ceil",
  },
} as const;

void asCssRect;
