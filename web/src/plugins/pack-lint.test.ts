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

type BadFixture = { rel: string; rule: PackLintRule; target: string };

const SANDBOX_BAD_FIXTURES: BadFixture[] = [
  { rel: "bad/parent.ts", rule: "sandbox-escape", target: "typeof parent" },
  { rel: "bad/top.ts", rule: "sandbox-escape", target: "top." },
  { rel: "bad/window-parent.ts", rule: "sandbox-escape", target: "window.parent" },
  { rel: "bad/window-top.ts", rule: "sandbox-escape", target: "window.top" },
  { rel: "bad/document-cookie.ts", rule: "sandbox-escape", target: "document.cookie" },
  { rel: "bad/local-storage.ts", rule: "sandbox-escape", target: "localStorage" },
  { rel: "bad/session-storage.ts", rule: "sandbox-escape", target: "sessionStorage" },
  { rel: "bad/indexed-db.ts", rule: "sandbox-escape", target: "indexedDB" },
];

const OTHER_BAD_FIXTURES: BadFixture[] = [
  { rel: "bad/host-import.ts", rule: "host-import", target: "../../../../web/src/plugins/host" },
  {
    rel: "bad/cross-pack-import.ts",
    rule: "cross-pack-import",
    target: "../../blob-mesh/frontend/index",
  },
  { rel: "bad/inline-zoto-declare.ts", rule: "inline-zoto-declare", target: "declare-const-zoto" },
  { rel: "bad/get-config-in-on-frame.ts", rule: "get-config-in-on-frame", target: "getConfig()" },
];

const ALL_PACK_BAD_FIXTURES = [...SANDBOX_BAD_FIXTURES, ...OTHER_BAD_FIXTURES];

/** Each form the host reverse-boundary rule must catch — one dedicated fixture per form. */
const HOST_BAD_FIXTURES: {
  rel: string;
  form: string;
  targets: string[];
  extraPaths?: Record<string, string[]>;
}[] = [
  {
    rel: "bad/static-pack-import.ts",
    form: "static import",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
  },
  {
    rel: "bad/dynamic-pack-import.ts",
    form: "dynamic import()",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
  },
  {
    rel: "bad/alias-pack-import.ts",
    form: "tsconfig paths alias",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
    extraPaths: hostAliasPaths,
  },
  {
    rel: "bad/reexport-named-pack.ts",
    form: "export { … } from",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
  },
  {
    rel: "bad/reexport-star-pack.ts",
    form: "export * from",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
  },
  {
    rel: "bad/require-pack.ts",
    form: "require()",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
  },
  {
    rel: "bad/glob-pack.ts",
    form: "import.meta.glob",
    targets: ["plugins/src/marble-run/frontend"],
  },
  {
    rel: "bad/loader-bypass-pack-source.ts",
    form: "loader-shaped path → pack source",
    targets: [
      "plugins/src/marble-run/frontend/config.ts",
      "plugins/src/marble-run/frontend/module.js",
    ],
  },
  {
    rel: "bad/raw-pack-import.ts",
    form: "import … ?raw",
    targets: ["plugins/src/marble-run/sky/fragment.glsl"],
  },
  {
    rel: "bad/url-pack-import.ts",
    form: "import … ?url",
    targets: ["plugins/src/marble-run/sky/fragment.glsl"],
  },
  {
    rel: "bad/http-url-pack-import.ts",
    form: "import() http URL",
    targets: ["plugins/src/marble-run/frontend/index.ts"],
  },
  {
    rel: "bad/https-url-pack-import.ts",
    form: "import() https URL",
    targets: ["plugins/src/marble-run/frontend/index.ts"],
  },
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
      "export async function load(id: string) {\n        return import(`/api/plugins/${id}/module.js?h=abc`);\n      }",
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

function hostHits(targets: string[]) {
  return targets.map((target) => ({
    file: HOST_FIXTURE_REL,
    rule: "host-imports-pack-src" as const,
    target,
  }));
}

describe("pack lint guardrails", () => {
  it("write baseline when PACK_LINT_WRITE_BASELINE=1", () => {
    if (process.env.PACK_LINT_WRITE_BASELINE !== "1") return;
    const current = scanAllGuardrails(repoRoot);
    const out = path.join(repoRoot, "plugins/sdk/pack-lint-baseline.json");
    const baselineRows = current.map(({ file, rule, target }) => ({ file, rule, target }));
    writeFileSync(out, `${JSON.stringify({ violations: baselineRows }, null, 2)}\n`);
  });

  it("plugins/src and web/src violations do not exceed the checked-in baseline", () => {
    const current = scanAllGuardrails(repoRoot);
    const baseline = loadBaseline(repoRoot);
    const { ok, newViolations, staleViolations } = assertBaselineGuard(current, baseline);
    if (!ok) {
      expect(newViolations).toEqual([]);
      expect(staleViolations).toEqual([]);
    }
    expect(ok).toBe(true);
  });

  it("reports baseline counts per pack and per rule (documentation)", () => {
    const baseline = loadBaseline(repoRoot);
    expect(Object.keys(baselineCountsByPack(baseline)).length).toBeGreaterThan(0);
    expect(baselineCountsByRule(baseline)["host-imports-pack-src"] ?? 0).toBeGreaterThan(0);
  });

  for (const { rel, rule, target } of ALL_PACK_BAD_FIXTURES) {
    it(`known-bad pack fixture ${rel} reports ${rule}`, () => {
      const hits = lintPackFixture(rel);
      expect(hits.map(({ file, rule: r, target: t }) => ({ file, rule: r, target: t }))).toEqual([
        { file: virtualPackPath(rel), rule, target },
      ]);
      if (rule === "inline-zoto-declare") {
        expect(hits[0]?.detail).toContain("VizZoto");
      }
    });
  }

  it("known-good pack fixture passes all rules", () => {
    expect(lintPackFixture("clean.ts")).toEqual([]);
  });

  for (const { rel, form, targets, extraPaths } of HOST_BAD_FIXTURES) {
    it(`host FAIL [${form}] ${rel}`, () => {
      const text = readFileSync(path.join(hostFixtureRoot, rel), "utf8");
      expect(extractModuleSpecifiers(text).length).toBeGreaterThan(0);
      const hits = lintHostFixture(rel, extraPaths);
      expect(hits.map(({ file, rule, target }) => ({ file, rule, target }))).toEqual(
        hostHits(targets).map(({ file, rule, target }) => ({ file, rule, target })),
      );
      for (const hit of hits) {
        expect(hit.detail?.length).toBeGreaterThan(0);
      }
    });
  }

  it("host import canonical target dedupes equivalent specifiers", () => {
    const text = `
      import a from "../../../plugins/src/marble-run/frontend/config";
      import b from "../../../plugins/src/marble-run/frontend/config.ts";
    `;
    const hits = scanHostLintFixture(HOST_FIXTURE_REL, text, repoRoot);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.target).toBe("plugins/src/marble-run/frontend/config.ts");
    expect(hits[0]?.detail).toBe('../../../plugins/src/marble-run/frontend/config');
  });

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
      { fixture: "bad/http-url-pack-import.ts (import() http URL)", ci: "FAIL" },
      { fixture: "bad/https-url-pack-import.ts (import() https URL)", ci: "FAIL" },
      { fixture: "bad/loader-bypass-pack-source.ts (loader-shaped path → pack source)", ci: "FAIL" },
      { fixture: "bad/raw-pack-import.ts (import … ?raw)", ci: "FAIL" },
      { fixture: "bad/reexport-named-pack.ts (export { … } from)", ci: "FAIL" },
      { fixture: "bad/reexport-star-pack.ts (export * from)", ci: "FAIL" },
      { fixture: "bad/require-pack.ts (require())", ci: "FAIL" },
      { fixture: "bad/static-pack-import.ts (static import)", ci: "FAIL" },
      { fixture: "bad/url-pack-import.ts (import … ?url)", ci: "FAIL" },
      { fixture: "clean/plugin-yml-presets.ts (read plugin.yml via fs)", ci: "PASS" },
      { fixture: "inline /api/plugins/<id>/module.js import()", ci: "PASS" },
    ]);
  });
});
