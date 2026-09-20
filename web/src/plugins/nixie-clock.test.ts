import { describe, expect, it } from "vitest";
import {
  digitsOf, packNixieBuffer, parseNixieLook, DEFAULT_LOOK,
} from "../../../plugins/src/nixie-clock/frontend/tubes";

function at(h: number, m: number, s: number, ms = 0): Date {
  return new Date(2026, 8, 20, h, m, s, ms);
}

describe("nixie clock pack", () => {
  it("splits 24-hour local time into six digits", () => {
    expect(digitsOf(at(15, 4, 5), false)).toEqual([1, 5, 0, 4, 0, 5]);
    expect(digitsOf(at(0, 0, 0), false)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(digitsOf(at(23, 59, 59), false)).toEqual([2, 3, 5, 9, 5, 9]);
  });

  it("uses 12-hour hours without a leading zero at noon/midnight", () => {
    expect(digitsOf(at(0, 7, 8), true)).toEqual([1, 2, 0, 7, 0, 8]);
    expect(digitsOf(at(12, 0, 1), true)).toEqual([1, 2, 0, 0, 0, 1]);
    expect(digitsOf(at(13, 30, 0), true)).toEqual([0, 1, 3, 0, 0, 0]);
  });

  it("packs look, blink, canvas, and pulse", () => {
    const buf = packNixieBuffer(at(9, 8, 7, 100), {
      hour12: false, seconds: true, glow: 1.2, flicker: 0.4,
    }, 0.3, 0.5, { w: 1600, h: 900 });
    expect(buf.slice(0, 6)).toEqual([0, 9, 0, 8, 0, 7]);
    expect(buf[6]).toBe(1);
    expect(buf[7]).toBe(1);
    expect(buf[8]).toBe(1.2);
    expect(buf[9]).toBe(0.4);
    expect(buf[10]).toBe(0.3);
    expect(buf[11]).toBe(1600);
    expect(buf[12]).toBe(900);
    expect(buf[13]).toBe(0);
    expect(buf[14]).toBe(0.5);
    const late = packNixieBuffer(at(9, 8, 7, 800), DEFAULT_LOOK);
    expect(late[6]).toBe(0);
  });

  it("parses This-view knobs with clamps", () => {
    expect(parseNixieLook({ format: "12", seconds: "0", glow: "9", flicker: "-1" })).toEqual({
      hour12: true, seconds: false, glow: 1.6, flicker: 0,
    });
    expect(parseNixieLook(undefined)).toEqual(DEFAULT_LOOK);
  });
});
