import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("typesafe-host wall epoch wiring", () => {
  it("replaces Date.now shadow timestamps with vizFrameEpochSec on every path", () => {
    const src = readFileSync(resolve(import.meta.dirname, "typesafe-host.ts"), "utf8");
    expect(src).toContain('import { vizFrameEpochSec } from "../core/viz-clock"');
    expect(src).not.toContain("Date.now() / 1000");
    expect((src.match(/vizFrameEpochSec\(state\.ts\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
