import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  disallowedHostPackSrcImports,
  formatViolationMessage,
  isLegacyDeclareZotoPackAllowed,
  LEGACY_DECLARE_ZOTO_PACK_IDS,
  scanHostLintFixture,
  scanPackInstallLint,
  scanWebSrc,
  type PackLintRule,
  type PackLintViolation,
} from "../../../plugins/sdk/pack-lint";
import {
  assertBaselineGuard,
  baselineCountsByPack,
  baselineCountsByRule,
  fullTreeScanCount,
  loadBaseline,
  scanAllGuardrails,
  scanPackLintFixture,
} from "../../../plugins/sdk/pack-lint-test-support";
import { PACK_BOUNDARY_FIX_HINT, packSymlinkEscapes } from "../../../plugins/sdk/pack-lint-import";
import { extractModuleSpecifiers, HOST_PACK_SRC_IMPORT_ALLOWLIST_COUNT } from "../../../plugins/sdk/pack-lint-host";
import { UNIFORM_BLOCKING_RULES } from "../../../plugins/sdk/pack-lint-types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "plugins/sdk/pack-lint-fixtures");
const hostFixtureRoot = path.join(repoRoot, "plugins/sdk/host-lint-fixtures");
const FIXTURE_PACK_ID = "lint-fixture-pack";
/** Synthetic host path for host-lint-fixtures scans (not a shipped module). */
const HOST_FIXTURE_REL = "web/src/plugins/pack-lint-host-fixture.ts";
const OFF_ALLOWLIST_ZOTO_FIXTURE = "plugins/sdk/pack-lint-fixtures/off-allowlist-inline-zoto.ts";
const OFF_ALLOWLIST_PACK_REPO_REL = "plugins/src/not-on-legacy-allowlist/frontend/index.ts";

const SHIPPED_GET_VIZ_ZOTO_PACK_IDS = [
  "backrooms",
  "blob-mesh",
  "cypher-cic",
  "hn-rain",
  "hn-term",
  "kefrens-bars",
  "lan-pulse",
  "marble-run",
  "nixie-clock",
  "packet-tunnel",
  "pulse-ts",
  "rf-constellation",
  "roto-proto",
  "star-sines",
  "stereo-gram",
  "syscon",
  "talker-storm",
] as const;

const hostAliasPaths = JSON.parse(
  readFileSync(path.join(hostFixtureRoot, "alias-paths.json"), "utf8"),
) as Record<string, string[]>;

type BadFixture = { rel: string; rule: PackLintRule; target: string; targetIncludes?: boolean };

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
  {
    rel: "bad/dynamic-host-import.ts",
    rule: "host-import",
    target: "../../../../web/src/plugins/host",
  },
  {
    rel: "bad/dynamic-escape-pack.ts",
    rule: "cross-pack-import",
    target: "../../blob-mesh/frontend/index",
  },
  {
    rel: "bad/require-host-import.ts",
    rule: "host-import",
    target: "../../../../web/src/plugins/host",
  },
  {
    rel: "bad/dynamic-import-non-literal.ts",
    rule: "unverified-import-call",
    target: "import(non-literal)",
  },
  {
    rel: "bad/export-from-cross-pack.ts",
    rule: "cross-pack-import",
    target: "../../blob-mesh/frontend/index",
  },
  {
    rel: "bad/side-effect-out-of-pack.ts",
    rule: "side-effect-import",
    target: "../../../../web/src/plugins/host",
  },
  {
    rel: "bad/side-effect-no-semicolon.ts",
    rule: "side-effect-import",
    target: "../../../../web/src/plugins/host",
  },
  {
    rel: "bad/static-http-import.ts",
    rule: "cross-pack-import",
    target: "https://example.com/plugins/src/marble-run/frontend/index.ts",
  },
  {
    rel: "bad/dynamic-http-import.ts",
    rule: "cross-pack-import",
    target: "https://example.com/plugins/src/marble-run/frontend/index.ts",
  },
  {
    rel: "bad/vite-fs-pack-import.ts",
    rule: "cross-pack-import",
    target: "marble-run/frontend/config.ts",
    targetIncludes: true,
  },
  {
    rel: "bad/shared-path-static.ts",
    rule: "host-import",
    target: "../../../../shared/runtime",
  },
  {
    rel: "bad/shared-path-dynamic.ts",
    rule: "host-import",
    target: "../../../../shared/runtime",
  },
  { rel: "bad/inline-zoto-declare.ts", rule: "inline-zoto-declare", target: "declare-const-zoto" },
  { rel: "bad/top-level-zoto-const.ts", rule: "pack-zoto-binding", target: "top-level-zoto" },
  { rel: "bad/get-config-in-on-frame.ts", rule: "get-config-in-on-frame", target: "getConfig()" },
  { rel: "bad/post-message.ts", rule: "host-transport-escape", target: "postMessage" },
];

const PACK_GOOD_FIXTURES = [
  "clean.ts",
  "good/dynamic-in-pack.ts",
  "good/commented-imports.ts",
  "good/side-effect-in-pack.ts",
  "good/import-in-string-literal.ts",
  "good/method-import-call.ts",
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
  {
    rel: "bad/https-prefix-pack-import.ts",
    form: "import() https prefixed pack path",
    targets: ["plugins/src/marble-run/frontend/index.ts"],
  },
  {
    rel: "bad/https-remote-import.ts",
    form: "import() https non-pack URL",
    targets: ["remote:https://example.com/vendor/lib.js"],
  },
  {
    rel: "bad/vite-fs-pack-import.ts",
    form: "import() /@fs/ pack path",
    targets: ["plugins/src/marble-run/frontend/config.ts"],
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
    run: () => {
      const src = "export async function load(id: string) {\n        return import(`/api/plugins/${id}/module.js?h=abc`);\n      }";
      expect(extractModuleSpecifiers(src).some((s) => s.includes("/api/plugins/") && s.includes("module.js"))).toBe(true);
      return scanHostLintFixture("web/src/plugins/host.ts", src, repoRoot);
    },
  },
];

function virtualPackPath(relUnderFixtureRoot: string): string {
  return `plugins/src/${FIXTURE_PACK_ID}/${relUnderFixtureRoot}`;
}

function lintPackFixture(relUnderFixtureRoot: string): ReturnType<typeof scanPackLintFixture> {
  const file = path.join(fixtureRoot, relUnderFixtureRoot);
  let text = readFileSync(file, "utf8");
  text = text.replaceAll("__REPO_ROOT__", repoRoot);
  return scanPackLintFixture(virtualPackPath(relUnderFixtureRoot), text, FIXTURE_PACK_ID, repoRoot);
}

function expectPackViolation(rel: string, rule: PackLintRule, target: string, targetIncludes = false): void {
  const hits = lintPackFixture(rel);
  const hit = hits.find((h) => h.rule === rule && (targetIncludes ? h.target.includes(target) : h.target === target));
  expect(hit, `expected ${rule} on ${target}, got: ${hits.map(formatViolationMessage).join("; ")}`).toBeDefined();
  expect(hit!.rule).toBe(rule);
  const formatted = formatViolationMessage(hit!);
  expect(formatted).toMatch(/:\d+/);
  if (targetIncludes || rule === "host-import" || rule === "cross-pack-import" || rule === "side-effect-import") {
    expect(formatted).toContain(target);
  }
  if (rule === "host-import" || rule === "cross-pack-import") {
    expect(formatted).toContain("plugins/sdk");
  }
  if (rule === "unverified-import-call") {
    expect(formatted).toContain("can't be checked");
    expect(formatted).toContain('./scenes/a');
  }
  if (rule === "inline-zoto-declare") {
    expect(formatted).toContain("declares zoto inline");
  }
}

function lintHostFixture(
  rel: string,
  extraPaths?: Record<string, string[]>,
): ReturnType<typeof scanHostLintFixture> {
  const text = readFileSync(path.join(hostFixtureRoot, rel), "utf8").replaceAll("__REPO_ROOT__", repoRoot);
  return scanHostLintFixture(HOST_FIXTURE_REL, text, repoRoot, extraPaths);
}

function hostHits(targets: string[]) {
  return targets.map((target) => ({
    file: HOST_FIXTURE_REL,
    rule: "host-imports-pack-src" as const,
    target,
  }));
}

/**
 * The one full-tree scan in this file (plugins/src, plugins/sdk, web/src, service and the #171 (b)
 * uniform scan). It takes a few seconds, more under load, so it runs once here with its own
 * explicit timeout and every real-tree row reads the result. Rows that lint fixtures or a temp
 * tree keep their own small scans. The last row pins exactly one full-tree scan per file.
 */
const FULL_TREE_SCAN_TIMEOUT_MS = 30_000;
let current: PackLintViolation[] = [];

describe("pack lint guardrails", () => {
  beforeAll(() => {
    const t0 = performance.now();
    current = scanAllGuardrails(repoRoot);
    console.info(`pack-lint full-tree scan: ${Math.round(performance.now() - t0)} ms`);
  }, FULL_TREE_SCAN_TIMEOUT_MS);

  it("write baseline when PACK_LINT_WRITE_BASELINE=1", () => {
    if (process.env.PACK_LINT_WRITE_BASELINE !== "1") return;
    const out = path.join(repoRoot, "plugins/sdk/pack-lint-baseline.json");
    const baselineRows = current
      .filter((v) => v.rule !== "host-imports-pack-src" && !UNIFORM_BLOCKING_RULES.has(v.rule))
      .map(({ file, rule, target }) => ({ file, rule, target }));
    writeFileSync(out, `${JSON.stringify({ violations: baselineRows }, null, 2)}\n`);
  });

  it("plugins/src and web/src violations do not exceed the checked-in baseline", () => {
    const baseline = loadBaseline(repoRoot);
    const {
      ok,
      newViolations,
      staleViolations,
      disallowedLegacyZoto,
      disallowedHostPackSrc,
      disallowedUniformBlocking,
    } = assertBaselineGuard(current, baseline);
    if (!ok) {
      expect(newViolations).toEqual([]);
      expect(staleViolations).toEqual([]);
      expect(disallowedLegacyZoto).toEqual([]);
      expect(disallowedHostPackSrc).toEqual([]);
      expect(disallowedUniformBlocking).toEqual([]);
    }
    expect(ok).toBe(true);
  });

  it("HOST_PACK_SRC_IMPORT_ALLOWLIST only shrinks (pinned debt count)", () => {
    expect(HOST_PACK_SRC_IMPORT_ALLOWLIST_COUNT).toBe(7);
  });

  it("host importing plugins/src outside debt allowlist fails with pack-source message", () => {
    const hits = lintHostFixture("bad/non-allowlist-pack-import.ts");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.rule).toBe("host-imports-pack-src");
    expect(hits[0]?.target).toContain("plugins/src/cypher-cic/");
    const msg = formatViolationMessage(hits[0]!);
    expect(msg).toMatch(/pack source|module\.js/);
    expect(disallowedHostPackSrcImports(hits).length).toBeGreaterThan(0);
  });

  it("shipped pack entries import getVizZoto via plugins/sdk/viz-zoto (PR C)", () => {
    for (const packId of SHIPPED_GET_VIZ_ZOTO_PACK_IDS) {
      const indexSrc = readFileSync(
        path.join(repoRoot, "plugins/src", packId, "frontend/index.ts"),
        "utf8",
      );
      expect(indexSrc).toMatch(/from "plugins\/sdk\/viz-zoto"/);
      expect(indexSrc).toMatch(/getVizZoto\(\)/);
    }
  });

  it("off-allowlist inline zoto declare fails disallowedLegacyZoto guard", () => {
    expect(isLegacyDeclareZotoPackAllowed("not-on-legacy-allowlist")).toBe(false);
    const text = readFileSync(path.join(repoRoot, OFF_ALLOWLIST_ZOTO_FIXTURE), "utf8");
    const hits = scanPackLintFixture(OFF_ALLOWLIST_PACK_REPO_REL, text, "not-on-legacy-allowlist", repoRoot);
    expect(hits.some((h) => h.rule === "inline-zoto-declare")).toBe(true);
    const { disallowedLegacyZoto } = assertBaselineGuard(hits, loadBaseline(repoRoot));
    expect(disallowedLegacyZoto.length).toEqual(1);
  });

  it("off-allowlist declare const zoto blocks pack install lint", () => {
    const text = readFileSync(path.join(repoRoot, OFF_ALLOWLIST_ZOTO_FIXTURE), "utf8");
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pack-install-lint-"));
    const packHome = path.join(tmp, "not-on-legacy-allowlist");
    const fe = path.join(packHome, "frontend");
    mkdirSync(fe, { recursive: true });
    writeFileSync(path.join(fe, "index.ts"), text);
    try {
      const { blocks } = scanPackInstallLint(packHome, repoRoot);
      expect(blocks.some((b) => b.rule === "inline-zoto-declare")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("LEGACY_DECLARE_ZOTO_PACK_IDS excludes every getVizZoto-migrated pack (PR C)", () => {
    for (const packId of SHIPPED_GET_VIZ_ZOTO_PACK_IDS) {
      expect(isLegacyDeclareZotoPackAllowed(packId)).toBe(false);
    }
    expect(LEGACY_DECLARE_ZOTO_PACK_IDS).toEqual([
      "ant-colony",
      "aquarium",
      "koi-pond",
      "metro-lines",
      "rocket-car-soccer",
      "voxel-world",
    ]);
    const text = readFileSync(path.join(repoRoot, OFF_ALLOWLIST_ZOTO_FIXTURE), "utf8");
    const hits = scanPackLintFixture(OFF_ALLOWLIST_PACK_REPO_REL, text, "not-on-legacy-allowlist", repoRoot);
    expect(hits.some((h) => h.rule === "inline-zoto-declare")).toBe(true);
    const { disallowedLegacyZoto } = assertBaselineGuard(hits, loadBaseline(repoRoot));
    expect(disallowedLegacyZoto.length).toBeGreaterThan(0);
  });

  it("reports baseline counts per pack and per rule (documentation)", () => {
    const baseline = loadBaseline(repoRoot);
    expect(Object.keys(baselineCountsByPack(baseline)).length).toBe(15);
    expect(baselineCountsByRule(baseline)["host-imports-pack-src"] ?? 0).toBe(0);
  });

  for (const { rel, rule, target, targetIncludes } of ALL_PACK_BAD_FIXTURES) {
    it(`known-bad pack fixture ${rel} reports ${rule}`, () => {
      expectPackViolation(rel, rule, target, targetIncludes);
      if (rule === "inline-zoto-declare") {
        const hits = lintPackFixture(rel);
        expect(hits[0]?.detail).toContain("VizZoto");
      }
    });
  }

  it("pack symlink escape is flagged (realpath)", () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pack-lint-pack-symlink-"));
    try {
      const packRepoPrefix = "plugins/src/symlink-probe-pack";
      const packDir = path.join(tmpRoot, packRepoPrefix);
      const outside = path.join(tmpRoot, "outside/blob.ts");
      mkdirSync(path.dirname(outside), { recursive: true });
      writeFileSync(outside, "export const x = 1;\n");
      mkdirSync(path.join(packDir, "frontend"), { recursive: true });
      writeFileSync(path.join(packDir, "frontend/index.ts"), "export const x = 1;\n");
      symlinkSync(outside, path.join(packDir, "frontend/escape.ts"));
      const raw = packSymlinkEscapes(packDir, packRepoPrefix, tmpRoot);
      expect(raw.length).toBe(1);
      const v = {
        file: raw[0]!.file,
        rule: "host-import" as const,
        target: raw[0]!.target,
        detail: raw[0]!.detail,
      };
      expect(formatViolationMessage(v)).toContain(PACK_BOUNDARY_FIX_HINT);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  for (const rel of PACK_GOOD_FIXTURES) {
    it(`known-good pack fixture ${rel} passes all rules`, () => {
      expect(lintPackFixture(rel)).toEqual([]);
    });
  }

  for (const { rel, form, targets, extraPaths } of HOST_BAD_FIXTURES) {
    it(`host FAIL [${form}] ${rel}`, () => {
      const text = readFileSync(path.join(hostFixtureRoot, rel), "utf8");
      expect(extractModuleSpecifiers(text).length).not.toBe(0);
      const hits = lintHostFixture(rel, extraPaths);
      expect(hits.map(({ file, rule, target }) => ({ file, rule, target }))).toEqual(
        hostHits(targets).map(({ file, rule, target }) => ({ file, rule, target })),
      );
      for (const hit of hits) {
        expect((hit.detail ?? "").length).not.toBe(0);
      }
    });
  }

  it("flags directory symlinks under web/src that point into plugins/src", () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "pack-lint-web-symlink-"));
    try {
      mkdirSync(path.join(tmpRoot, "web"), { recursive: true });
      writeFileSync(
        path.join(tmpRoot, "web/tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: {} } }),
      );
      const packDir = path.join(tmpRoot, "plugins/src/symlink-target-pack/frontend");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(path.join(packDir, "index.ts"), "export {};\n");
      const fixtureDir = path.join(tmpRoot, "web/src/symlink-fixture");
      mkdirSync(fixtureDir, { recursive: true });
      symlinkSync(packDir, path.join(fixtureDir, "pack-link"), "dir");
      writeFileSync(path.join(fixtureDir, "pack-link/probe.ts"), "export {};\n");
      const hits = scanWebSrc(tmpRoot).filter((v) => v.file.includes("symlink-fixture"));
      expect(hits.length).toBe(1);
      expect(hits[0]?.target).toContain("plugins/src/symlink-target-pack");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("does not treat import() inside string literals as dynamic imports", () => {
    expect(lintPackFixture("good/import-in-string-literal.ts")).toEqual([]);
  });

  it("does not treat obj.import() as a dynamic import call", () => {
    expect(lintPackFixture("good/method-import-call.ts")).toEqual([]);
  });

  it("flags template dynamic import with expressions as unverified", () => {
    const hits = lintPackFixture("good/dynamic-template-expression.ts");
    expect(hits.some((h) => h.rule === "unverified-import-call")).toBe(true);
    expect(hits.some((h) => h.rule === "host-import")).toBe(false);
  });

  it("host import canonical target dedupes equivalent specifiers", () => {
    const rel = "web/src/plugins/host-import-dedupe-fixture.ts";
    const text = readFileSync(
      path.join(hostFixtureRoot, "clean/canonical-import-dedupe.ts"),
      "utf8",
    );
    const hits = scanHostLintFixture(rel, text, repoRoot);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.target).toBe("plugins/src/marble-run/frontend/config.ts");
    expect(hits[0]?.detail).toBe("../../../plugins/src/marble-run/frontend/config");
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
      { fixture: "bad/https-prefix-pack-import.ts (import() https prefixed pack path)", ci: "FAIL" },
      { fixture: "bad/https-remote-import.ts (import() https non-pack URL)", ci: "FAIL" },
      { fixture: "bad/https-url-pack-import.ts (import() https URL)", ci: "FAIL" },
      { fixture: "bad/loader-bypass-pack-source.ts (loader-shaped path → pack source)", ci: "FAIL" },
      { fixture: "bad/raw-pack-import.ts (import … ?raw)", ci: "FAIL" },
      { fixture: "bad/reexport-named-pack.ts (export { … } from)", ci: "FAIL" },
      { fixture: "bad/reexport-star-pack.ts (export * from)", ci: "FAIL" },
      { fixture: "bad/require-pack.ts (require())", ci: "FAIL" },
      { fixture: "bad/static-pack-import.ts (static import)", ci: "FAIL" },
      { fixture: "bad/url-pack-import.ts (import … ?url)", ci: "FAIL" },
      { fixture: "bad/vite-fs-pack-import.ts (import() /@fs/ pack path)", ci: "FAIL" },
      { fixture: "clean/plugin-yml-presets.ts (read plugin.yml via fs)", ci: "PASS" },
      { fixture: "inline /api/plugins/<id>/module.js import()", ci: "PASS" },
    ]);
  });

  // Keep this row last: it counts every full-tree scan the rows above ran.
  it("runs exactly one full-tree scan (the shared beforeAll); no row re-scans the tree on its own", () => {
    expect(current.length).toBeGreaterThan(0);
    expect(fullTreeScanCount()).toBe(1);
  });
});
