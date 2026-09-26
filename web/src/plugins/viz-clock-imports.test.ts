import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const BLOCKED = [
  "plugins/viz-host.ts",
  "plugins/typesafe-host.ts",
  "plugins/viz-tile-budget.ts",
  "plugins/viz-tile-hud.ts",
  "plugins/dogfood-runner.ts",
  "plugins/dogfood-tile-budget.ts",
  "plugins/dogfood-tile-hud.ts",
];

describe("viz wall clock import guard", () => {
  it("import lint: budget and scheduler paths do not import vizWallMs", () => {
    for (const rel of BLOCKED) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src.includes("vizWallMs"), rel).toBe(false);
    }
  });
});
