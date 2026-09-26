import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("plugin host viz tile scope wiring", () => {
  it("imports syncVizTileScope and calls it on sandbox unload", () => {
    const src = readFileSync(resolve(import.meta.dirname, "host.ts"), "utf8");
    expect(src).toContain('import { syncVizTileScope } from "./viz-tile-budget"');
    expect(src).toMatch(/unload\(\): void \{[\s\S]*syncVizTileScope\(\["main"\]\)/);
  });
});
