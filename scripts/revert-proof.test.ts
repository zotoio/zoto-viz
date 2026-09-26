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

function runGit(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
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
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

function runPnpmInstall(root: string) {
  const create = spawnSync("pnpm", ["install"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (create.status !== 0) {
    throw new Error(`fixture pnpm install failed: ${create.stderr || create.stdout}`);
  }
  const frozen = spawnSync("pnpm", ["install", "--offline", "--frozen-lockfile"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (frozen.status !== 0) {
    throw new Error(
      `fixture offline pnpm install failed: ${frozen.stderr || frozen.stdout}`,
    );
  }
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
    `export function value() { return 1; }\n`,
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

  fs.writeFileSync(
    path.join(root, "web", "revert-proof", "widget.test.ts"),
    `import { describe, expect, it } from "vitest";
import { value } from "@rp/widget";

describe("widget", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
});
`,
  );

  fs.writeFileSync(
    path.join(root, ".gitignore"),
    "node_modules/\nweb/node_modules/\n.venv/\n",
  );

  runPnpmInstall(root);

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
@@ -1 +1 @@
-export function value() { return 1; }
+export function value() { return 2; }
`;

const noopPatch = `--- a/packages/rp-widget/index.js
+++ b/packages/rp-widget/index.js
@@ -1 +1 @@
-export function value() { return 1; }
+export function value() { return 1; }
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
@@ -1 +1 @@
-export function value() { return 1; }
+export function value() { return 1
`;

const pyGoodPatch = `--- a/rpfixture/core.py
+++ b/rpfixture/core.py
@@ -1 +1 @@
-answer = 1
+answer = 2
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

  it("(a) correct revert row produces red output and exit 0", () => {
    const root = mkFixture();
    writeRow(root, "99", "valid-revert", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "returns one",
      description: "Break widget return value",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "valid-revert"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(i) workspace package imported by name goes red on revert", () => {
    const root = mkFixture();
    writeRow(root, "99", "workspace-pkg", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "returns one",
      description: "Revert @rp/widget workspace package",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "workspace-pkg"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(b) noop patch stays green fails naming the row", () => {
    const root = mkFixture();
    writeRow(root, "99", "stays-green", noopPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "returns one",
      description: "No-op revert",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "stays-green"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row stays-green/);
    assertCheckoutUnchanged(root, before);
  });

  it("(c) patch touching test files is rejected", () => {
    const root = mkFixture();
    writeRow(root, "99", "touch-test", testTouchPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "returns one",
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
      testName: "returns one",
      description: "Syntax error in widget",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "build-break"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row build-break.*build/i);
    assertCheckoutUnchanged(root, before);
  });

  it("(e) filter matching zero tests is rejected", () => {
    const root = mkFixture();
    writeRow(root, "99", "no-match", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "does-not-exist",
      description: "Narrow filter",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "no-match"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row no-match/);
    assertCheckoutUnchanged(root, before);
  });

  it("(f) filter matching two tests is rejected", () => {
    const root = mkFixture(`
  it("returns one duplicate", () => {
    expect(value()).toBe(1);
  });
`);
    writeRow(root, "99", "two-match", goodPatch, {
      runner: "vitest",
      testFile: "web/revert-proof/widget.test.ts",
      testName: "returns one",
      description: "Ambiguous filter",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "two-match"]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row two-match.*exactly 1 test/i);
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
      testName: "returns one hang",
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
      testName: "sigint hang",
      description: "SIGINT",
      timeoutSec: 120,
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, "99", "--row", "sigint-row"], {
        cwd: root,
        env: { ...process.env, FORCE_COLOR: "0" },
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

    const wtList = runGit(root, ["worktree", "list"]);
    expect(wtList.includes("revert-proof-wt")).toBe(false);
    assertCheckoutUnchanged(root, before);
  });
});

describe("patchTouchesTestFiles", () => {
  it("flags tests paths", async () => {
    const mod = await import("./revert-proof.mjs");
    expect(
      mod.patchTouchesTestFiles("--- a/tests/foo.py\n+++ b/tests/foo.py\n"),
    ).toBe(true);
    expect(
      mod.patchTouchesTestFiles("--- a/src/foo.ts\n+++ b/src/foo.ts\n"),
    ).toBe(false);
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
