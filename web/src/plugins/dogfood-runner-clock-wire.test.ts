import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("dogfood-runner clock wiring", () => {
  it("runPackSwapPreserve defaults now to vizClockMs", () => {
    const src = readFileSync(resolve(import.meta.dirname, "dogfood-runner.ts"), "utf8");
    expect(src).toMatch(/runPackSwapPreserve[\s\S]*now: \(\) => number = vizClockMs/);
  });
});
