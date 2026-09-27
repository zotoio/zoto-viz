import { beforeEach, describe, expect, it } from "vitest";
import { isBlackFillHex, paintLetterboxBars, surfaceLetterboxFill } from "./letterbox-fill";

describe("letterbox fill", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("uses surface canvas colour, not black", () => {
    const fill = surfaceLetterboxFill(0x3a5f7c, 0.2);
    expect(isBlackFillHex(fill.hex)).toBe(false);
    expect(fill.css).toMatch(/rgb\(58,\s*95,\s*124\)/);
  });

  it("nudges exact black clear to a non-black bar fill", () => {
    const fill = surfaceLetterboxFill(0x000000, 0);
    expect(isBlackFillHex(fill.hex)).toBe(false);
    expect(fill.css).toBe("rgb(18, 18, 18)");
  });

  it("skips painting pure black bar fill", () => {
    const rects: number[] = [];
    const ctx = {
      save: () => {},
      restore: () => {},
      fillStyle: "",
      fillRect: (...args: number[]) => { rects.push(...args); },
    } as CanvasRenderingContext2D;
    paintLetterboxBars(
      ctx,
      { x: 0, y: 0, w: 80, h: 60 },
      { x: 20, y: 10, w: 40, h: 40 },
      { css: "rgb(0, 0, 0)", grain: 0, hex: 0, pattern: null },
    );
    expect(rects.length).toBe(0);
  });
});
