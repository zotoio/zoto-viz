import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBaselineGuard,
  baselineCountsByPack,
  loadBaseline,
  scanPackLintFixture,
  scanPluginsSrc,
  type PackLintRule,
} from "../../../plugins/sdk/pack-lint";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "plugins/sdk/pack-lint-fixtures");

const ALL_RULES: PackLintRule[] = [
  "sandbox-escape",
  "host-import",
  "cross-pack-import",
  "inline-zoto-declare",
  "get-config-in-on-frame",
];

describe("pack lint guardrails", () => {
  it("write baseline when PACK_LINT_WRITE_BASELINE=1", () => {
    if (process.env.PACK_LINT_WRITE_BASELINE !== "1") return;
    const current = scanPluginsSrc(repoRoot);
    const out = path.join(repoRoot, "plugins/sdk/pack-lint-baseline.json");
    writeFileSync(out, `${JSON.stringify({ violations: current }, null, 2)}\n`);
  });

  it("plugins/src violations do not exceed the checked-in baseline", () => {
    const current = scanPluginsSrc(repoRoot);
    const baseline = loadBaseline(repoRoot);
    const { ok, newViolations } = assertBaselineGuard(current, baseline);
    if (!ok) {
      expect(newViolations).toEqual([]);
    }
    expect(ok).toBe(true);
  });

  it("reports baseline counts per pack (documentation)", () => {
    const baseline = loadBaseline(repoRoot);
    const counts = baselineCountsByPack(baseline);
    expect(Object.keys(counts).length).toBeGreaterThan(0);
  });

  for (const rule of ALL_RULES) {
    it(`fixture catches ${rule}`, () => {
      const file = path.join(fixtureRoot, `${rule}.ts`);
      const text = readFileSync(file, "utf8");
      const hits = scanPackLintFixture(`plugins/src/fixture-pack/${rule}.ts`, text, "fixture-pack", repoRoot);
      expect(hits.some((h) => h.rule === rule)).toBe(true);
    });
  }

  it("clean fixture passes all rules", () => {
    const file = path.join(fixtureRoot, "clean.ts");
    const text = readFileSync(file, "utf8");
    const hits = scanPackLintFixture("plugins/src/fixture-pack/clean.ts", text, "fixture-pack", repoRoot);
    expect(hits).toEqual([]);
  });
});
