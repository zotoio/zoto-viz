import { beforeEach, describe, expect, it } from "vitest";
import { asCanvasDeviceHeight, deviceRectFromHostViewBoxInto } from "./pack-mirror-rect";

describe("deviceRectFromHostViewBoxInto canvas cap", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("clamps device height when GL rect extends past canvasDevicePx", () => {
    const out = { x: 0, y: 0, w: 0, h: 0 };
    deviceRectFromHostViewBoxInto(
      { x: 0, y: 0, w: 100, h: 100 },
      false,
      100,
      1,
      out,
      asCanvasDeviceHeight(80),
    );
    expect(out.y + out.h).toBeLessThanOrEqual(80);
    expect(out.h).toBe(80);
  });
});
