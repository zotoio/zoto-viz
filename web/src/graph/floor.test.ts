import { describe, expect, it } from "vitest";
import { FLOOR_SHAPES } from "./floor";

describe("FLOOR_SHAPES", () => {
  it("includes hex and the packed set", () => {
    expect(FLOOR_SHAPES.map((o) => o.value)).toEqual(["square", "hex", "triangle", "diamond", "circle"]);
  });
});
