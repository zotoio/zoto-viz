import { describe, expect, it } from "vitest";
import { rejectPatchedVitestGreen } from "./revert-proof.mjs";

describe("revert-proof dogfood guards", () => {
  it("stays-green guard rejects patched green vitest runs", () => {
    expect(() => rejectPatchedVitestGreen("green", "dogfood")).toThrow(
      /stayed GREEN/,
    );
  });
});
