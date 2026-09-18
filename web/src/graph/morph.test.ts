import { describe, expect, it } from "vitest";
import { mixFade, mixShape, smoothstep, VIEW_MORPH_S } from "./morph";

describe("view morph", () => {
  it("eases shape indices between graph looks", () => {
    expect(VIEW_MORPH_S).toBeGreaterThan(0.5);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(mixShape(0, 4, 0)).toBe(0);
    expect(mixShape(0, 4, 1)).toBe(4);
    expect(mixShape(0, 4, 0.5)).toBe(2);
    expect(mixShape(1, 3, 0.25)).toBeGreaterThan(1);
    expect(mixShape(1, 3, 0.25)).toBeLessThan(1.5);
    expect(mixFade(0)).toBe(0);
    expect(mixFade(1)).toBe(1);
    expect(mixFade(0.5)).toBe(0.5);
  });
});
