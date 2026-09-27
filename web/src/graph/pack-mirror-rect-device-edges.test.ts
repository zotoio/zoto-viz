import { beforeEach, describe, expect, it } from "vitest";
import {
  asCanvasDeviceHeight,
  deviceRectFromHostViewBoxInto,
  deviceRectTopLeftCssInto,
} from "./pack-mirror-rect";

describe("pack-mirror rect device edges", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("deviceRectTopLeftCssInto rounds x1 with Math.round at fractional right edge", () => {
    const out = { x: 0, y: 0, w: 0, h: 0 };
    deviceRectTopLeftCssInto({ x: 0.2, y: 0.2, w: 1.2, h: 1.2 }, 1.5, out);
    expect([out.x, out.y, out.w, out.h]).toEqual([0, 0, 2, 2]);
  });

  it("deviceRectTopLeftCssInto rounds y1 with Math.round at fractional bottom edge", () => {
    const out = { x: 0, y: 0, w: 0, h: 0 };
    deviceRectTopLeftCssInto({ x: 0.2, y: 0.25, w: 1.2, h: 1.2 }, 1.5, out);
    expect([out.x, out.y, out.w, out.h]).toEqual([0, 0, 2, 2]);
  });

  it("deviceRectFromHostViewBoxInto GPU path uses toDeviceRectInto rounding on host view boxes", () => {
    const out = { x: 0, y: 0, w: 0, h: 0 };
    deviceRectFromHostViewBoxInto(
      { x: 1, y: 58, w: 101, h: 61 },
      false,
      120,
      1.5,
      out,
      asCanvasDeviceHeight(180),
    );
    expect([out.x, out.y, out.w, out.h]).toEqual([2, 2, 151, 91]);
  });
});
