import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
/** Resolved beside this test file so git-worktree proofs exercise the tree under test. */
const scriptPath = path.join(scriptsDir, "revert-proof.mjs");

type RowMeta = {
  runner: string;
  testFile: string;
  testName: string;
  description: string;
  timeoutSec?: number;
  pythonModule?: string;
};

const GIT_IDENTITY = ["-c", "user.name=rp-fixture", "-c", "user.email=rp@fixture.test"];

function runGit(cwd: string, args: string[]) {
  const r = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function hostPython(): string {
  const venvPy = path.join(repoRoot, ".venv", "bin", "python3");
  if (fs.existsSync(venvPy)) return venvPy;
  const r = spawnSync("python3", ["-c", "import sys;print(sys.executable)"], {
    encoding: "utf8",
  });
  return r.stdout.trim() || "python3";
}

function fixturePython(root: string): string {
  const py = path.join(root, ".venv", "bin", "python3");
  if (fs.existsSync(py)) return py;
  return hostPython();
}

function ensureFixtureVenv(root: string) {
  const venvDir = path.join(root, ".venv");
  if (!fs.existsSync(path.join(venvDir, "bin", "python3"))) {
    const create = spawnSync("python3", ["-m", "venv", venvDir], {
      cwd: root,
      encoding: "utf8",
    });
    if (create.status !== 0) {
      throw new Error(`fixture venv failed: ${create.stderr || create.stdout}`);
    }
  }
  const py = path.join(venvDir, "bin", "python3");
  const pipPytest = spawnSync(py, ["-m", "pip", "install", "pytest"], {
    cwd: root,
    encoding: "utf8",
  });
  if (pipPytest.status !== 0) {
    throw new Error(`fixture pip pytest failed: ${pipPytest.stderr || pipPytest.stdout}`);
  }
}

function runPnpmInstall(root: string) {
  const r = spawnSync("pnpm", ["install"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`fixture pnpm install failed: ${r.stderr || r.stdout}`);
  }
}

function assertNoRevertProofWorktrees(root: string) {
  const wtList = runGit(root, ["worktree", "list"]);
  expect(wtList.includes("revert-proof-wt")).toBe(false);
}

function snapshotCheckout(root: string) {
  return {
    head: runGit(root, ["rev-parse", "HEAD"]).trim(),
    porcelain: runGit(root, ["status", "--porcelain"]),
  };
}

function assertCheckoutUnchanged(
  root: string,
  before: { head: string; porcelain: string },
  pr = "99",
) {
  const after = snapshotCheckout(root);
  expect(after.head).toBe(before.head);
  const stripReport = (s: string) =>
    s
      .split("\n")
      .filter((line) => line.trim() && !line.includes(`revert-proofs/${pr}/REPORT.md`))
      .join("\n");
  expect(stripReport(after.porcelain)).toBe(stripReport(before.porcelain));
}

function runRevertProof(cwd: string, prNumber: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [scriptPath, prNumber, ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      REVERT_PROOF_PYTHON: fixturePython(cwd),
    },
  });
}

function writeFixtureRepo(root: string) {
  fs.mkdirSync(path.join(root, "packages", "rp-widget"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "web"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages:\n  - 'packages/*'\n  - 'web'\n",
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "rp-fixture-root", private: true }, null, 2),
  );
  fs.mkdirSync(path.join(root, "web", "revert-proof"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "rp-widget", "package.json"),
    JSON.stringify(
      {
        name: "@rp/widget",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, "packages", "rp-widget", "index.js"),
    `export function value() { return 1; }
export const ctxLine2 = 0;
export const ctxLine3 = 0;
export const ctxLine4 = 0;
export const ctxLine5 = 0;
export const ctxLine6 = 0;
`,
  );
  fs.writeFileSync(
    path.join(root, "web", "package.json"),
    JSON.stringify(
      {
        name: "rp-web",
        private: true,
        type: "module",
        dependencies: { "@rp/widget": "workspace:*" },
        devDependencies: { vitest: "^5.0.0" },
      },
      null,
      2,
    ),
  );

  fs.copyFileSync(scriptPath, path.join(root, "scripts", "revert-proof.mjs"));
  fs.copyFileSync(
    path.join(scriptsDir, "revert-proof-lib.mjs"),
    path.join(root, "scripts", "revert-proof-lib.mjs"),
  );
  fs.writeFileSync(
    path.join(root, "scripts", "vitest.config.mjs"),
    `import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.REVERT_PROOF_ROOT
  ? path.resolve(process.env.REVERT_PROOF_ROOT)
  : path.resolve(scriptsDir, "..");
export default {
  root: repoRoot,
  cacheDir: path.join(repoRoot, "web", "node_modules", ".vite"),
  test: {
    environment: "node",
    include: [
      path.join(scriptsDir, "**/*.test.ts"),
      path.join(repoRoot, "web", "revert-proof", "**/*.test.ts"),
    ],
    testTimeout: 120_000,
  },
};
`,
  );

  fs.writeFileSync(
    path.join(root, "web", "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowJs: true,
        },
        include: ["../packages/**/*.js"],
      },
      null,
      2,
    ),
  );

  fs.mkdirSync(path.join(root, "web", "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(root, "web", "src", "prod"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "web", "src", "app", "main.ts"),
    `import { readWidget } from "../prod/consumer.js";
readWidget();
`,
  );
  fs.writeFileSync(
    path.join(root, "web", "src", "prod", "consumer.ts"),
    `import { value } from "@rp/widget";
export function readWidget() {
  return value();
}
`,
  );
  fs.writeFileSync(
    path.join(root, "web", "src", "test-only-helper.ts"),
    `export function helperToken() {
  return 1;
}
`,
  );
  fs.writeFileSync(
    path.join(root, "scripts", "revert-proof-production.json"),
    JSON.stringify(
      {
        scanRoots: ["web/src", "packages", "service", "rpfixture"],
        entryPoints: ["web/src/app/main.ts", "service/monitor.py"],
        reachExempt: [
          "scripts/revert-proof.mjs",
          "scripts/revert-proof-lib.mjs",
          "rpfixture/core.py",
        ],
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(root, "web", "revert-proof", "widget.test.ts"),
    `import { describe, expect, it } from "vitest";
import { value } from "../../packages/rp-widget/index.js";
import { helperToken } from "../src/test-only-helper.ts";

describe("widget", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
  it("helper ok", () => {
    expect(helperToken()).toBe(1);
  });
});
`,
  );

  fs.mkdirSync(path.join(root, "service"), { recursive: true });
  fs.writeFileSync(path.join(root, "service", "__init__.py"), "");
  fs.writeFileSync(path.join(root, "service", "live.py"), "SERVICE_LIVE = 1\n");
  fs.writeFileSync(
    path.join(root, "service", "monitor.py"),
    `from . import live

def main():
    return live.SERVICE_LIVE
`,
  );
  fs.mkdirSync(path.join(root, "rpfixture"), { recursive: true });
  fs.writeFileSync(path.join(root, "rpfixture", "__init__.py"), "");
  fs.writeFileSync(path.join(root, "rpfixture", "core.py"), "answer = 1\n");
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tests", "test_selection.py"),
    `import pytest
from rpfixture.core import answer

@pytest.mark.parametrize("v", ["ok"], ids=["talkers[].failed"])
def test_bracket_id(v):
    assert answer == 1

@pytest.mark.parametrize("v", [1], ids=["a and b"])
def test_and_id(v):
    assert answer == 1
`,
  );

  fs.writeFileSync(
    path.join(root, "web", "vitest.config.mjs"),
    `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
`,
  );

  fs.mkdirSync(path.join(root, "web", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "web", "src", "web-project.test.ts"),
    `import { describe, expect, it } from "vitest";
import { value } from "../../packages/rp-widget/index.js";
describe("webpkg", () => {
  it("web row runs one test", () => {
    expect(value()).toBe(1);
  });
});
`,
  );

  fs.writeFileSync(
    path.join(root, "pyproject.toml"),
    `[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"
[project]
name = "rp-editable"
version = "0.0.0"
[tool.setuptools.packages.find]
where = ["."]
`,
  );

  fs.writeFileSync(
    path.join(root, ".gitignore"),
    "node_modules/\nweb/node_modules/\n.venv/\n*.egg-info/\n",
  );

  runPnpmInstall(root);
  ensureFixtureVenv(root);
  const py = path.join(root, ".venv", "bin", "python3");
  const pipEditable = spawnSync(py, ["-m", "pip", "install", "-e", ".", "--no-deps"], {
    cwd: root,
    encoding: "utf8",
  });
  if (pipEditable.status !== 0) {
    throw new Error(`editable install failed: ${pipEditable.stderr || pipEditable.stdout}`);
  }

  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "init"]);
}

function writeRow(
  root: string,
  pr: string,
  slug: string,
  patchBody: string,
  meta: RowMeta,
) {
  const dir = path.join(root, "revert-proofs", pr);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.patch`), patchBody, "utf8");
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(meta, null, 2), "utf8");
}

function commitRevertProofs(root: string) {
  runGit(root, ["add", "revert-proofs"]);
  runGit(root, ["commit", "-m", "add revert-proof rows"]);
}

const goodPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1,2 +1,2 @@
-export function value() { return 1; }
+export function value() { return 2; }
 export const ctxLine2 = 0;
`;

const noopPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1,2 +1,2 @@
-export function value() { return 1; }
+export function value() { return 1; }
 export const ctxLine2 = 0;
`;

const testTouchPatch = `--- a/web/revert-proof/widget.test.ts
+++ b/web/revert-proof/widget.test.ts
@@ -5,7 +5,7 @@
 describe("widget", () => {
   it("returns one", () => {
-    expect(value()).toBe(1);
+    expect(value()).toBe(9);
   });
 });
`;

const syntaxBreakPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1,2 +1,2 @@
-export function value() { return 1; }
+export function value() { return 1
 export const ctxLine2 = 0;
`;

const pyGoodPatch = `--- a/rpfixture/core.py
+++ b/rpfixture/core.py
@@ -1 +1 @@
-answer = 1
+answer = 2
`;

const testOnlyHelperPatch = `--- a/web/src/test-only-helper.ts
+++ b/web/src/test-only-helper.ts
@@ -1,3 +1,3 @@
 export function helperToken() {
-  return 1;
+  return 2;
 }
`;

describe("revert-proof runner (fixture repo)", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const t of temps.splice(0)) {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  function mkFixture(extraTestBody = "") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "revert-proof-"));
    temps.push(root);
    writeFixtureRepo(root);
    if (extraTestBody) {
      const testPath = path.join(root, "web", "revert-proof", "widget.test.ts");
      fs.appendFileSync(testPath, extraTestBody);
      runGit(root, ["add", "web/revert-proof/widget.test.ts"]);
      runGit(root, ["commit", "-m", "extra tests"]);
    }
    return root;
  }

  it("(m) revert patch on test-only helper is rejected as unreachable", () => {
    const root = mkFixture();
    writeRow(root, "99", "test-only-target", testOnlyHelperPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > helper ok",
      description: "Revert test-only helper",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "test-only-target"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(
      /row test-only-target.*revert target unreachable from production: web\/src\/test-only-helper\.ts/i,
    );
    assertCheckoutUnchanged(root, before);
  });

  it("(n) revert patch on production-reached module is accepted", () => {
    const root = mkFixture();
    writeRow(root, "99", "prod-reached", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Revert production-reached widget package",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "prod-reached"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(w) web project row uses web vitest config and runs exactly one test", () => {
    const root = mkFixture();
    writeRow(root, "99", "web-project-row", goodPatch, {
      runner: "vitest",
      testFile: "web/src/web-project.test.ts",
      testName: "webpkg > web row runs one test",
      description: "Web cwd/config row",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "web-project-row"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertNoRevertProofWorktrees(root);
    assertCheckoutUnchanged(root, before);
  });

  it("(multi-test-file) row in a file with many tests runs exactly one", () => {
    const root = mkFixture();
    writeRow(root, "99", "multi-file", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Multi-test file single selection",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99", ["--row", "multi-file"]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertNoRevertProofWorktrees(root);
  });

  it("(a) correct revert row produces red output and exit 0", () => {
    const root = mkFixture();
    writeRow(root, "99", "valid-revert", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Break widget return value",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "valid-revert"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(j2) describe title containing literal ' > ' selects exactly one test", () => {
    const root = mkFixture();
    fs.writeFileSync(
      path.join(root, "web", "revert-proof", "widget.test.ts"),
      `import { describe, expect, it } from "vitest";
import { value } from "../../packages/rp-widget/index.js";

describe("widget > alpha", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
});

describe("widget", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
});
`,
    );
    runGit(root, ["add", "web/revert-proof/widget.test.ts"]);
    runGit(root, ["commit", "-m", "describe title with gt"]);
    writeRow(root, "99", "describe-gt", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > alpha > returns one",
      description: "Describe title contains literal > separator",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "describe-gt"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertNoRevertProofWorktrees(root);
    assertCheckoutUnchanged(root, before);
  });

  it("(j) testName with regex metacharacters selects exactly one test", () => {
    const root = mkFixture();
    fs.writeFileSync(
      path.join(root, "web", "revert-proof", "widget.test.ts"),
      `import { describe, expect, it } from "vitest";
import { value } from "../../packages/rp-widget/index.js";

describe("widget (beta)", () => {
  it("talkers[].failed", () => {
    expect(value()).toBe(1);
  });
});
`,
    );
    runGit(root, ["add", "web/revert-proof/widget.test.ts"]);
    runGit(root, ["commit", "-m", "bracket title test"]);
    writeRow(root, "99", "regex-title", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget (beta) > talkers[].failed",
      description: "Bracket title must not be treated as RegExp",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "regex-title"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertNoRevertProofWorktrees(root);
    assertCheckoutUnchanged(root, before);
  });

  it("(b) noop patch stays green fails naming the row", () => {
    const root = mkFixture();
    writeRow(root, "99", "stays-green", noopPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "No-op revert",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "stays-green"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row stays-green/);
    assertNoRevertProofWorktrees(root);
    assertCheckoutUnchanged(root, before);
  });

  it("(c3) patch with wrong outer context is rejected by git apply --check", () => {
    const root = mkFixture();
    writeRow(root, "99", "wrong-outer-ctx", wrongOuterContextPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Hunk context mismatch",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99", ["--row", "wrong-outer-ctx"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row wrong-outer-ctx.*git apply --check failed/i);
    assertNoRevertProofWorktrees(root);
  });

  it("(c2) patch that does not apply cleanly fails the row", () => {
    const root = mkFixture();
    writeRow(root, "99", "bad-patch", badContextPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Hunk mismatch",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "bad-patch"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row bad-patch.*git apply --check failed/i);
    expect(fs.existsSync(path.join(root, "packages", "rp-widget", "index.js.orig"))).toBe(
      false,
    );
    expect(
      fs
        .readdirSync(path.join(root, "packages", "rp-widget"))
        .some((f) => f.endsWith(".rej")),
    ).toBe(false);
    assertCheckoutUnchanged(root, before);
  });

  it("(c) patch touching test files is rejected", () => {
    const root = mkFixture();
    writeRow(root, "99", "touch-test", testTouchPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Illegal test edit",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "touch-test"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row touch-test.*test files/i);
    assertCheckoutUnchanged(root, before);
  });

  it("(d) syntax break in production module is rejected as build break", () => {
    const root = mkFixture();
    writeRow(root, "99", "build-break", syntaxBreakPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Syntax error in widget",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "build-break"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row build-break.*build/i);
    assertCheckoutUnchanged(root, before);
  });

  it("(e) filter matching zero tests is rejected on baseline", () => {
    const root = mkFixture();
    writeRow(root, "99", "no-match", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > does-not-exist",
      description: "Narrow filter",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "no-match"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row no-match.*ran 0 tests/i);
    assertCheckoutUnchanged(root, before);
  });

  it("(f) filter matching two tests is rejected", () => {
    const root = mkFixture();
    fs.writeFileSync(
      path.join(root, "web", "revert-proof", "widget.test.ts"),
      `import { describe, expect, it } from "vitest";
import { value } from "../../packages/rp-widget/index.js";

describe("widget", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
});

describe("widget", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
});
`,
    );
    runGit(root, ["add", "web/revert-proof/widget.test.ts"]);
    runGit(root, ["commit", "-m", "duplicate fullTestName"]);
    writeRow(root, "99", "two-match", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Ambiguous filter",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "two-match"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row two-match.*exactly 1 test.*got 2/i);
    assertCheckoutUnchanged(root, before);
  });

  it("(g) hanging test is rejected as timeout", () => {
    const root = mkFixture();
    const hangTest = `import { describe, it } from "vitest";
describe("hang", () => {
  it("returns one hang", async () => {
    await new Promise(() => {});
  });
});
`;
    fs.writeFileSync(path.join(root, "web", "revert-proof", "hang.test.ts"), hangTest);
    runGit(root, ["add", "web/revert-proof/hang.test.ts"]);
    runGit(root, ["commit", "-m", "hang test"]);
    writeRow(root, "99", "hang", noopPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/hang.test.ts",
      testName: "hang > returns one hang",
      description: "Hang",
      timeoutSec: 2,
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "hang"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row hang.*timed out/i);
    expect(r.stdout + r.stderr).not.toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(py-editable) editable install row goes red only with worktree isolation", () => {
    const root = mkFixture();
    const editablePatch = `--- a/rpfixture/core.py
+++ b/rpfixture/core.py
@@ -1 +1 @@
-answer = 1
+answer = 2
`;
    writeRow(root, "99", "editable-py", editablePatch, {
      runner: "pytest",
      testFile: "tests/test_selection.py",
      testName: "test_bracket_id[talkers[].failed]",
      pythonModule: "rpfixture",
      description: "Editable package revert",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "editable-py"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertNoRevertProofWorktrees(root);
    assertCheckoutUnchanged(root, before);
  });

  it("(vitest-fake-assertion) plain object throw without JUnit type is not assertion red", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const junit = `<?xml version="1.0"?><testsuites><testcase name="t"><failure message="AssertionError: expect(received).toBe(expected)">not a real AssertionError</failure></testcase></testsuites>`;
    expect(lib.isVitestAssertionFailure([], junit)).toBe(false);
    const kind = lib.classifyPatchedVitest({
      counts: {
        executed: 1,
        passed: 0,
        failed: 1,
        suiteError: null,
        failedAssertions: [{ messages: ["AssertionError: expect(received).toBe(expected)"] }],
        ranTests: [{ fullName: "d > t", status: "failed" }],
      },
      junitXml: junit,
    });
    expect(kind).toBe("build break");
  });

  it("(junit-multi-file) multi-test file still selects one executed junit case", async () => {
    const mod = await import("./revert-proof.mjs");
    const xml = `<?xml version="1.0"?><testsuite>
<testcase name="other" classname="widget"><skipped/></testcase>
<testcase name="returns one" classname="widget > alpha"/>
<testcase name="decoy" classname="widget"><skipped/></testcase>
</testsuite>`;
    const executed = mod.vitestJunitExecutedTestNames(xml);
    expect(executed.length).toBe(1);
    expect(executed[0]).toContain("widget > alpha > returns one");
  });

  it("(vitest-rangeerror) RangeError junit failure is not assertion red", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const junit = `<?xml version="1.0"?><testsuites><testcase name="t"><failure type="RangeError">Expected 1 to be 2</failure></testcase></testsuites>`;
    const kind = lib.classifyPatchedVitest({
      counts: {
        executed: 1,
        passed: 0,
        failed: 1,
        suiteError: null,
        failedAssertions: [{ messages: ["RangeError: Expected 1 to be 2"] }],
        ranTests: [{ fullName: "d > t", status: "failed" }],
      },
      junitXml: junit,
    });
    expect(kind).toBe("build break");
  });

  it("(pytest-probe-error) ProbeError message is not assertion red", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const body = `<failure message="service.rp_probe.ProbeError: bad input"># AssertionError in comment</failure>`;
    expect(lib.isPytestAssertionBody(body)).toBe(false);
    const kind = lib.classifyPatchedPytest({
      counts: {
        collectionError: false,
        cases: [{ name: "t", outcome: "failed", body }],
      },
    });
    expect(kind).toBe("build break");
  });

  it("(pytest-traceback-assert) assert line in traceback is not assertion red", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const body = `<failure message="TypeError: boom">tests/test_live.py:75: in foo
    assert False
TypeError: boom</failure>`;
    expect(lib.isPytestAssertionBody(body)).toBe(false);
    const kind = lib.classifyPatchedPytest({
      counts: {
        collectionError: false,
        cases: [{ name: "t", outcome: "failed", body }],
      },
    });
    expect(kind).toBe("build break");
  });

  it("(phantom-leaf) sidecar full name must match junit selection", () => {
    const root = mkFixture();
    fs.writeFileSync(
      path.join(root, "web", "revert-proof", "widget.test.ts"),
      `import { describe, expect, it } from "vitest";
import { value } from "../../packages/rp-widget/index.js";
describe("widget", () => {
  it("same leaf", () => expect(value()).toBe(1);
});
describe("other", () => {
  it("same leaf", () => expect(value()).toBe(1);
});
`,
    );
    runGit(root, ["add", "web/revert-proof/widget.test.ts"]);
    runGit(root, ["commit", "-m", "duplicate leaf titles"]);
    writeRow(root, "99", "phantom-leaf", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > missing test",
      description: "Nonexistent full name",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99", ["--row", "phantom-leaf"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row phantom-leaf.*ran 0 tests|exactly 1 test/i);
    assertNoRevertProofWorktrees(root);
  });

  it("(service-reach) relative import service module is production-reachable", () => {
    const root = mkFixture();
    fs.writeFileSync(
      path.join(root, "tests", "test_service_live.py"),
      `from service import live

def test_service_live_value():
    assert live.SERVICE_LIVE == 1
`,
    );
    runGit(root, ["add", "tests/test_service_live.py"]);
    runGit(root, ["commit", "-m", "service live pytest"]);
    const livePatch = `--- a/service/live.py
+++ b/service/live.py
@@ -1 +1 @@
-SERVICE_LIVE = 1
+SERVICE_LIVE = 2
`;
    writeRow(root, "99", "service-live", livePatch, {
      runner: "pytest",
      testFile: "tests/test_service_live.py",
      testName: "test_service_live_value",
      pythonModule: "service",
      description: "Revert service/live via monitor relative import",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99", ["--row", "service-live"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertNoRevertProofWorktrees(root);
  });

  it("(reach-exempt-first) reachExempt from config applies before first touched file", () => {
    const root = mkFixture();
    const exemptPatch = `--- a/scripts/revert-proof-lib.mjs
+++ b/scripts/revert-proof-lib.mjs
@@ -1,4 +1,4 @@
 /** Shared pure helpers for revert-proof (imported by runner + tests). */
 import fs from "node:fs";
 import path from "node:path";
-
+// reach-exempt dogfood touch
`;
    writeRow(root, "99", "reach-exempt-touch", exemptPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "Touch reach-exempt lib (noop comment)",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99", ["--row", "reach-exempt-touch"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).not.toMatch(/unreachable from production.*revert-proof-lib/);
  });

  it("(vitest-typeerror) TypeError patched run is rejected as build break", () => {
    const root = mkFixture();
    const typeErrorPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1,2 +1,2 @@
-export function value() { return 1; }
+export function value() { throw new TypeError("boom"); }
 export const ctxLine2 = 0;
`;
    writeRow(root, "99", "type-error", typeErrorPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "widget > returns one",
      description: "TypeError not assertion",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99", ["--row", "type-error"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row type-error.*assertion|build/i);
    assertNoRevertProofWorktrees(root);
  });

  it("(vitest-green-class) classifyPatchedVitest reports green when patched passes", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const kind = lib.classifyPatchedVitest({
      counts: { executed: 1, passed: 1, failed: 0, suiteError: null, failedAssertions: [] },
    });
    expect(kind).toBe("green");
  });

  it("(h) SIGINT during a row leaves checkout and worktrees clean", async () => {
    const root = mkFixture();
    const hangTest = `import { describe, it } from "vitest";
describe("hang", () => {
  it("sigint hang", async () => {
    await new Promise(() => {});
  });
});
`;
    fs.writeFileSync(path.join(root, "web", "revert-proof", "sigint.test.ts"), hangTest);
    runGit(root, ["add", "web/revert-proof/sigint.test.ts"]);
    runGit(root, ["commit", "-m", "sigint test"]);
    writeRow(root, "99", "sigint-row", noopPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/sigint.test.ts",
      testName: "hang > sigint hang",
      description: "SIGINT",
      timeoutSec: 120,
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);

    const artifactsBefore = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith("revert-proof-artifacts-"));

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, "99", "--row", "sigint-row"], {
        cwd: root,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          REVERT_PROOF_PYTHON: fixturePython(root),
        },
      });
      const timer = setTimeout(() => {
        child.kill("SIGINT");
      }, 2500);
      child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.on("error", reject);
    });

    await new Promise((r) => setTimeout(r, 500));
    const wtMarker = `revert-proof-wt-${path.basename(root)}`;
    const vitestLeft = spawnSync("pgrep", ["-f", wtMarker], { encoding: "utf8" });
    expect(vitestLeft.stdout.trim()).toBe("");
    const artifactsAfter = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith("revert-proof-artifacts-"));
    expect(artifactsAfter.length).toBe(artifactsBefore.length);
    const wtList = runGit(root, ["worktree", "list"]);
    expect(wtList.includes("revert-proof-wt")).toBe(false);
    assertCheckoutUnchanged(root, before);
  });

  it("(k) pytest node id with bracket parametrize id selects one test", () => {
    const root = mkFixture();
    writeRow(root, "99", "pytest-brackets", pyGoodPatch, {
      runner: "pytest",
      testFile: "tests/test_selection.py",
      testName: "test_bracket_id[talkers[].failed]",
      pythonModule: "rpfixture",
      description: "Revert answer for bracket parametrize id",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "pytest-brackets"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(l) pytest node id with a and b id selects one test", () => {
    const root = mkFixture();
    writeRow(root, "99", "pytest-and", pyGoodPatch, {
      runner: "pytest",
      testFile: "tests/test_selection.py",
      testName: "test_and_id[a and b]",
      pythonModule: "rpfixture",
      description: "Revert answer for a and b parametrize id",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "pytest-and"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });
});

const badContextPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1 +1 @@
-export function value() { return 9; }
+export function value() { return 2; }
`;

const wrongOuterContextPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1,6 +1,6 @@
-export function value() { return 1; }
+export function value() { return 2; }
-export const ctxLine2 = 99;
-export const ctxLine3 = 99;
-export const ctxLine4 = 99;
-export const ctxLine5 = 99;
 export const ctxLine6 = 0;
`;

describe("vitest testName escaping", () => {
  it("escapes and anchors fullTestName for -t", async () => {
    const mod = await import("./revert-proof.mjs");
    expect(mod.vitestTestNamePattern("widget > alpha > returns one")).toBe(
      "^widget > alpha > returns one$",
    );
    expect(mod.vitestTestNamePattern("widget (beta) > talkers[].failed")).toBe(
      "^widget \\(beta\\) > talkers\\[\\]\\.failed$",
    );
    expect(mod.escapeVitestTestNamePattern("a(b)*+?")).toBe("a\\(b\\)\\*\\+\\?");
    expect(
      mod.vitestJunitExecutedTestNames(
        `<testsuite>
<testcase name="other &gt; filtered"><skipped/></testcase>
<testcase name="widget &gt; alpha &gt; returns one"/>
</testsuite>`,
      ),
    ).toEqual([["widget > alpha > returns one"]]);
    expect(
      mod.vitestJunitExecutedTestNames(
        `<testsuite><testcase classname="widget &amp; alpha" name="returns one"/></testsuite>`,
      ),
    ).toEqual([["returns one", "widget & alpha > returns one"]]);
  });

  it("builds pytest node ids", async () => {
    const mod = await import("./revert-proof.mjs");
    expect(
      mod.pytestNodeId(
        "tests/test_selection.py",
        "test_bracket_id[talkers[].failed]",
      ),
    ).toBe("tests/test_selection.py::test_bracket_id[talkers[].failed]");
    expect(mod.pytestNodeId("tests/test_selection.py", "test_and_id[a and b]")).toBe(
      "tests/test_selection.py::test_and_id[a and b]",
    );
  });
});

describe("patchTouchesTestFiles", () => {
  it("flags tests paths", async () => {
    const mod = await import("./revert-proof.mjs");
    expect(
      mod.patchTouchesTestFiles("--- a/tests/foo.py\n+++ b/tests/foo.py\n"),
    ).toBe(true);
    expect(
      mod.patchTouchesTestFiles("--- a/web/src/test/setup.ts\n+++ b/web/src/test/setup.ts\n"),
    ).toBe(true);
    expect(
      mod.patchTouchesTestFiles("--- a/src/foo.ts\n+++ b/src/foo.ts\n"),
    ).toBe(false);
  });
});

describe("revert-proof-lib guards", () => {
  it("(allowTypeError-strict) string false does not enable allowTypeError", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    expect(lib.allowTypeErrorEnabled({ allowTypeError: "false" })).toBe(false);
    expect(lib.allowTypeErrorEnabled({ allowTypeError: true })).toBe(true);
  });

  it("(timeoutSec) rejects invalid timeoutSec", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    expect(() => lib.parseTimeoutSec(0, "x")).toThrow(/positive finite/);
    expect(() => lib.parseTimeoutSec(-1, "x")).toThrow(/positive finite/);
    expect(() => lib.parseTimeoutSec("abc" as unknown as number, "x")).toThrow(
      /positive finite/,
    );
  });

  it("(pr-number) rejects path traversal PR numbers", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    expect(() => lib.validatePrNumber("../..")).toThrow(/invalid PR number/);
  });

  it("(pythonModule) rejects injection in pythonModule", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    expect(() => lib.validatePythonModule('os;print("x")#')).toThrow(/invalid pythonModule/);
  });

  it("(pytest-no-k) buildPytestArgv never uses -k", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const argv = lib.buildPytestArgv("tests/t.py::test_x", "/tmp/out.xml");
    expect(argv.includes("-k")).toBe(false);
    expect(lib.pytestArgvUsesNodeIdNotK(argv)).toBe(true);
  });

  it("(junit-pass-fail) self-closing pass does not swallow following fail", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const xml = `<?xml version="1.0"?><testsuite>
<testcase classname="t" name="pass" time="0"/>
<testcase classname="t" name="fail" time="0"><failure>AssertionError: assert 1 == 2</failure></testcase>
</testsuite>`;
    const parsed = lib.parsePytestJunit(xml, 1);
    expect(parsed.executed).toBe(2);
    expect(parsed.cases[1]?.outcome).toBe("failed");
  });

  it("(junit-pass-skip) pass then skip yields one executed test", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const xml = `<?xml version="1.0"?><testsuite>
<testcase classname="t" name="pass" time="0"/>
<testcase classname="t" name="skip" time="0"><skipped/></testcase>
</testsuite>`;
    const parsed = lib.parsePytestJunit(xml, 0);
    expect(parsed.executed).toBe(1);
  });

  it("(junit-collection) non-zero exit with no cases is collection error", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const parsed = lib.parsePytestJunit("", 2);
    expect(parsed.collectionError).toBe(true);
    expect(parsed.executed).toBe(0);
  });

  it("(pytest-error-tag) error outcome is not assertion red", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const kind = lib.classifyPatchedPytest({
      counts: {
        collectionError: false,
        cases: [{ name: "t", outcome: "error", body: "AttributeError: boom" }],
      },
    });
    expect(kind).toBe("build break");
  });

  it("(pytest-attr) AttributeError failure without assert is build break", async () => {
    const lib = await import("./revert-proof-lib.mjs");
    const kind = lib.classifyPatchedPytest({
      counts: {
        collectionError: false,
        cases: [{ name: "t", outcome: "failed", body: "AttributeError: boom" }],
      },
    });
    expect(kind).toBe("build break");
  });

  it("(python-env) PYTHONPATH is set to worktree", async () => {
    const mod = await import("./revert-proof.mjs");
    const env = mod.pythonEnvForWorktree("/wt");
    expect(env.PYTHONPATH).toBe("/wt");
  });
});

describe("isolation guards", () => {
  it("rejects workspace symlinks that escape the worktree", async () => {
    const mod = await import("./revert-proof.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-guard-"));
    const nm = path.join(root, "node_modules", "@scope", "pkg");
    fs.mkdirSync(path.dirname(nm), { recursive: true });
    fs.symlinkSync("/tmp", nm);
    expect(() => mod.assertWorkspaceLinksInWorktree(root)).toThrow(
      /outside worktree/i,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("(link-guard-main) rejects symlinks into the main checkout", async () => {
    const mod = await import("./revert-proof.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-guard-main-"));
    const target = path.join(repoRoot, "plugins");
    if (!fs.existsSync(target)) {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    }
    const nm = path.join(root, "node_modules", "escape-pkg");
    fs.mkdirSync(path.dirname(nm), { recursive: true });
    fs.symlinkSync(target, nm);
    expect(() => mod.assertWorkspaceLinksInWorktree(root)).toThrow(
      /outside worktree/i,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects editable python resolving outside the worktree", async () => {
    const mod = await import("./revert-proof.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-py-guard-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rp-out-"));
    fs.mkdirSync(path.join(outside, "rpfixture"), { recursive: true });
    fs.writeFileSync(path.join(outside, "rpfixture", "__init__.py"), "");
    fs.writeFileSync(path.join(outside, "rpfixture", "core.py"), "answer = 1\n");
    fs.symlinkSync(path.join(outside, "rpfixture"), path.join(root, "rpfixture"), "dir");
    const py = spawnSync("python3", ["-c", "import sys;print(sys.executable)"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(() =>
      mod.assertEditablePythonResolvesInWorktree(root, py, "rpfixture"),
    ).toThrow(/outside worktree/i);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
