import { describe, expect, it } from "vitest";
import { horizontalFov, lensFov, MAX_H_FOV } from "./lens-fov";

describe("lensFov", () => {
  it("leaves a square frame on the base lens", () => {
    expect(lensFov(55, 1)).toBeCloseTo(55);
  });

  it("narrows a wide frame so the horizontal field stays at the cap", () => {
    const aspect = 2;
    const wide = horizontalFov(55, aspect);
    expect(wide).toBeGreaterThan(MAX_H_FOV);
    const next = lensFov(55, aspect);
    expect(next).toBeLessThan(55);
    expect(horizontalFov(next, aspect)).toBeCloseTo(MAX_H_FOV, 4);
  });
});
