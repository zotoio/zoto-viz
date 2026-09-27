import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "main.ts");

describe("main.ts feed paint wiring", () => {
  it("calls applyFeedSlotPaints from feed()", () => {
    const src = readFileSync(mainPath, "utf8");
    expect(src).toMatch(/applyFeedSlotPaints\s*\(/);
    expect(src).not.toMatch(/mosaic\?\.update\(paint\)/);
  });
});
