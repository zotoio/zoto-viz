import { describe, expect, it } from "vitest";
import { isBlackFill, paintLetterboxBars, surfaceLetterboxFill } from "./letterbox-fill";

describe("letterbox fill", () => {
  it("uses surface canvas colour, not black", () => {
    const fill = surfaceLetterboxFill(0x3a5f7c, 0.2);
    expect(isBlackFill(fill.css)).toBe(false);
    expect(fill.css).toMatch(/rgb\(58,\s*95,\s*124\)/);
  });

  it("rejects black bar fill", () => {
    const ctx = { save: () => {}, restore: () => {}, fillStyle: "", fillRect: () => {} } as CanvasRenderingContext2D;
    expect(() => paintLetterboxBars(
      ctx,
      { x: 0, y: 0, w: 80, h: 60 },
      { x: 20, y: 10, w: 40, h: 40 },
      { css: "rgb(0, 0, 0)", grain: 0 },
    )).toThrow(/must not be black/);
  });
});
