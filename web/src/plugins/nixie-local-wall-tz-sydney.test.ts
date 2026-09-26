import { describe, expect, it } from "vitest";
import { localWallPartsFromDate } from "./nixie-wall-parts";

describe("nixie real local wall (Australia/Sydney)", () => {
  it("winter offset -600 and 01:05 local parts from Date fields", () => {
    const d = new Date(2024, 5, 15, 1, 5, 0);
    expect(d.getTimezoneOffset()).toBe(-600);
    expect(localWallPartsFromDate(d)).toEqual({ h: 1, m: 5, s: 0 });
  });
});
