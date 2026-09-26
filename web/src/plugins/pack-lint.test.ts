import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertBaselineGuard,
  baselineCountsByPack,
  baselineCountsByRule,
  loadBaseline,
  scanAllGuardrails,
  scanHostLintFixture,
  scanPackLintFixture,
  type PackLintRule,
} from "../../../plugins/sdk/pack-lint";
import { extractModuleSpecifiers } from "../../../plugins/sdk/pack-lint-host";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "plugins/sdk/pack-lint-fixtures");
const hostFixtureRoot = path.join(repoRoot, "plugins/sdk/host-lint-fixtures");
const FIXTURE_PACK_ID = "lint-fixture-pack";
const HOST_FIXTURE_REL = "web/src/plugins/fractal-config-ui.ts";

const hostAliasPaths = JSON.parse(
  readFileSync(path.join(hostFixtureRoot, "alias-paths.json"), "utf8"),
) as Record<string, string[]>;

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

const ALL_PACK_BAD_FIXTURES = [...SANDBOX_BAD_FIXTURES, ...OTHER_BAD_FIXTURES];

/** Each form the host reverse-boundary rule must catch — one dedicated fixture per form. */
const HOST_BAD_FIXTURES: {
  rel: string;
  form: string;
  extraPaths?: Record<string, string[]>;
}[] = [
  { rel: "bad/static-pack-import.ts", form: "static import" },
  { rel: "bad/dynamic-pack-import.ts", form: "dynamic import()" },
  { rel: "bad/alias-pack-import.ts", form: "tsconfig paths alias", extraPaths: hostAliasPaths },
  { rel: "bad/reexport-named-pack.ts", form: "export { … } from" },
  { rel: "bad/reexport-star-pack.ts", form: "export * from" },
  { rel: "bad/require-pack.ts", form: "require()" },
  { rel: "bad/glob-pack.ts", form: "import.meta.glob" },
  { rel: "bad/loader-bypass-pack-source.ts", form: "loader-shaped path → pack source" },
];

const HOST_PASS_FIXTURES: { label: string; run: () => ReturnType<typeof scanHostLintFixture> }[] = [
  {
    label: "clean/plugin-yml-presets.ts (read plugin.yml via fs)",
    run: () => {
      const text = readFileSync(path.join(hostFixtureRoot, "clean/plugin-yml-presets.ts"), "utf8");
      return scanHostLintFixture("web/src/ui/pack-presets.ts", text, repoRoot);
    },
  },
  {
    label: "inline /api/plugins/<id>/module.js import()",
    run: () => scanHostLintFixture(
      "web/src/plugins/host.ts",
      `export async function load(id: string) {
        return import("/api/plugins/" + id + "/module.js?h=abc");
      }`,
      repoRoot,
    ),
  },
];

function virtualPackPath(relUnderFixtureRoot: string): string {
  return `plugins/src/${FIXTURE_PACK_ID}/${relUnderFixtureRoot}`;
}

function lintPackFixture(relUnderFixtureRoot: string): ReturnType<typeof scanPackLintFixture> {
  const file = path.join(fixtureRoot, relUnderFixtureRoot);
  const text = readFileSync(file, "utf8");
  return scanPackLintFixture(
    virtualPackPath(relUnderFixtureRoot),
    text,
    FIXTURE_PACK_ID,
    repoRoot,
  );
}

function lintHostFixture(
  rel: string,
  extraPaths?: Record<string, string[]>,
): ReturnType<typeof scanHostLintFixture> {
  const text = readFileSync(path.join(hostFixtureRoot, rel), "utf8");
  return scanHostLintFixture(HOST_FIXTURE_REL, text, repoRoot, extraPaths);
}

describe("pack lint guardrails", () => {
  it("write baseline when PACK_LINT_WRITE_BASELINE=1", () => {
    if (process.env.PACK_LINT_WRITE_BASELINE !== "1") return;
    const current = scanAllGuardrails(repoRoot);
    const out = path.join(repoRoot, "plugins/sdk/pack-lint-baseline.json");
    writeFileSync(out, `${JSON.stringify({ violations: current }, null, 2)}\n`);
  });

  it("plugins/src and web/src violations do not exceed the checked-in baseline", () => {
    const current = scanAllGuardrails(repoRoot);
    const baseline = loadBaseline(repoRoot);
    const { ok, newViolations } = assertBaselineGuard(current, baseline);
    if (!ok) {
      expect(newViolations).toEqual([]);
    }
    expect(ok).toBe(true);
  });

  it("reports baseline counts per pack and per rule (documentation)", () => {
    const baseline = loadBaseline(repoRoot);
    expect(Object.keys(baselineCountsByPack(baseline)).length).toBeGreaterThan(0);
    expect(baselineCountsByRule(baseline)["host-imports-pack-src"] ?? 0).toBeGreaterThan(0);
  });

  for (const { rel, rule } of ALL_PACK_BAD_FIXTURES) {
    it(`known-bad pack fixture ${rel} reports ${rule}`, () => {
      const hits = lintPackFixture(rel);
      expect(hits).toEqual([{ file: virtualPackPath(rel), rule }]);
    });
  }

  it("known-good pack fixture passes all rules", () => {
    expect(lintPackFixture("clean.ts")).toEqual([]);
  });

  for (const { rel, form, extraPaths } of HOST_BAD_FIXTURES) {
    it(`host FAIL [${form}] ${rel}`, () => {
      const text = readFileSync(path.join(hostFixtureRoot, rel), "utf8");
      expect(extractModuleSpecifiers(text).length).toBeGreaterThan(0);
      const hits = lintHostFixture(rel, extraPaths);
      expect(hits).toEqual([{ file: HOST_FIXTURE_REL, rule: "host-imports-pack-src" }]);
    });
  }

  for (const { label, run } of HOST_PASS_FIXTURES) {
    it(`host PASS ${label}`, () => {
      expect(run()).toEqual([]);
    });
  }

  it("host boundary fixture catalog (pass/fail summary)", () => {
    const rows: { fixture: string; ci: "FAIL" | "PASS" }[] = HOST_BAD_FIXTURES.map(({ rel, form }) => ({
      fixture: `${rel} (${form})`,
      ci: "FAIL",
    }));
    for (const { label } of HOST_PASS_FIXTURES) {
      rows.push({ fixture: label, ci: "PASS" });
    }
    rows.sort((a, b) => a.fixture.localeCompare(b.fixture));
    expect(rows).toEqual([
      { fixture: "bad/alias-pack-import.ts (tsconfig paths alias)", ci: "FAIL" },
      { fixture: "bad/dynamic-pack-import.ts (dynamic import())", ci: "FAIL" },
      { fixture: "bad/glob-pack.ts (import.meta.glob)", ci: "FAIL" },
      { fixture: "bad/loader-bypass-pack-source.ts (loader-shaped path → pack source)", ci: "FAIL" },
      { fixture: "bad/reexport-named-pack.ts (export { … } from)", ci: "FAIL" },
      { fixture: "bad/reexport-star-pack.ts (export * from)", ci: "FAIL" },
      { fixture: "bad/require-pack.ts (require())", ci: "FAIL" },
      { fixture: "bad/static-pack-import.ts (static import)", ci: "FAIL" },
      { fixture: "clean/plugin-yml-presets.ts (read plugin.yml via fs)", ci: "PASS" },
      { fixture: "inline /api/plugins/<id>/module.js import()", ci: "PASS" },
    ]);
  });
});
