import { describe, expect, it } from "vitest";
import { tileLimitedSharingLabel, vizCadenceOrdinal } from "./viz-copy";

describe("vizCadenceOrdinal (Amendment 6 L3)", () => {
  const cases: [number, string][] = [
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
  ];

  for (const [k, ord] of cases) {
    it(`k=${k} → ${ord}`, () => {
      expect(vizCadenceOrdinal(k)).toBe(ord);
    });
  }
});

describe("tileLimitedSharingLabel (Amendment 6 L1 literal)", () => {
  it("pins the single template string for N=4 k=3", () => {
    expect(tileLimitedSharingLabel(4, 3)).toBe(
      "LIMITED · sharing frame with 4 tiles · updating every 3rd frame",
    );
  });
});
