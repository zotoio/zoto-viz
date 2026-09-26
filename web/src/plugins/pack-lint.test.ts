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
const badFixtureRoot = path.join(fixtureRoot, "bad");
const FIXTURE_PACK_ID = "lint-fixture-pack";

type BadFixture = { rel: string; rule: PackLintRule };

const SANDBOX_BAD_FIXTURES: BadFixture[] = [
  { rel: "bad/parent.ts", rule: "sandbox-escape" },
  { rel: "bad/top.ts", rule: "sandbox-escape" },
  { rel: "bad/window-parent.ts", rule: "sandbox-escape" },
  { rel: "bad/window-top.ts", rule: "sandbox-escape" },
  { rel: "bad/document-cookie.ts", rule: "sandbox-escape" },
  { rel: "bad/local-storage.ts", rule: "sandbox-escape" },
  { rel: "bad/session-storage.ts", rule: "sandbox-escape" },
  { rel: "bad/indexed-db.ts", rule: "sandbox-escape" },
];

const OTHER_BAD_FIXTURES: BadFixture[] = [
  { rel: "bad/host-import.ts", rule: "host-import" },
  { rel: "bad/cross-pack-import.ts", rule: "cross-pack-import" },
  { rel: "bad/inline-zoto-declare.ts", rule: "inline-zoto-declare" },
  { rel: "bad/get-config-in-on-frame.ts", rule: "get-config-in-on-frame" },
];

const ALL_BAD_FIXTURES = [...SANDBOX_BAD_FIXTURES, ...OTHER_BAD_FIXTURES];

function virtualPackPath(relUnderFixtureRoot: string): string {
  return `plugins/src/${FIXTURE_PACK_ID}/${relUnderFixtureRoot}`;
}

function lintFixture(relUnderFixtureRoot: string): ReturnType<typeof scanPackLintFixture> {
  const file = path.join(fixtureRoot, relUnderFixtureRoot);
  const text = readFileSync(file, "utf8");
  return scanPackLintFixture(
    virtualPackPath(relUnderFixtureRoot),
    text,
    FIXTURE_PACK_ID,
    repoRoot,
  );
}

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

  for (const { rel, rule } of ALL_BAD_FIXTURES) {
    it(`known-bad fixture ${rel} reports ${rule}`, () => {
      const hits = lintFixture(rel);
      expect(hits).toEqual([{ file: virtualPackPath(rel), rule }]);
    });
  }

  it("known-good fixture passes all rules", () => {
    const hits = lintFixture("clean.ts");
    expect(hits).toEqual([]);
  });
});
