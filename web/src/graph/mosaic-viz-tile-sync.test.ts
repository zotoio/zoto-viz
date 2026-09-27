import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mosaic viz tile scope sync (production hunk rows)", () => {
  it("syncPanes and teardown call syncVizTileScope", () => {
    const src = readFileSync(resolve(import.meta.dirname, "mosaic.ts"), "utf8");
    expect(src).toContain('syncVizTileScope(ids.length ? ids : ["main"])');
    expect(src).toMatch(/private teardown\(\): void \{[\s\S]*syncVizTileScope\(\[\]\)/);
  });
});
