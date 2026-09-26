import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "revert-proof.mjs");

type RowMeta = {
  runner: string;
  testFile: string;
  testName: string;
  description: string;
  timeoutSec?: number;
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

function writeFixtureRepo(root: string) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "web"), { recursive: true });

  fs.symlinkSync(
    path.join(repoRoot, "web", "node_modules"),
    path.join(root, "web", "node_modules"),
  );

  fs.copyFileSync(scriptPath, path.join(root, "scripts", "revert-proof.mjs"));
  fs.copyFileSync(
    path.join(repoRoot, "scripts", "vitest.config.mjs"),
    path.join(root, "scripts", "vitest.config.mjs"),
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
        include: ["../src/**/*.js"],
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(root, "src", "widget.js"),
    `export function value() { return 1; }\n`,
  );
  fs.writeFileSync(
    path.join(root, "scripts", "widget.test.ts"),
    `import { describe, expect, it } from "vitest";
import { value } from "../src/widget.js";

describe("widget", () => {
  it("returns one", () => {
    expect(value()).toBe(1);
  });
});
`,
  );

  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");

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

const goodPatch = `--- a/src/widget.js
+++ b/src/widget.js
@@ -1 +1 @@
-export function value() { return 1; }
+export function value() { return 2; }
`;

const noopPatch = `--- a/src/widget.js
+++ b/src/widget.js
@@ -1 +1 @@
-export function value() { return 1; }
+export function value() { return 1; }
`;

const testTouchPatch = `--- a/scripts/widget.test.ts
+++ b/scripts/widget.test.ts
@@ -5,7 +5,7 @@
 describe("widget", () => {
   it("returns one", () => {
-    expect(value()).toBe(1);
+    expect(value()).toBe(9);
   });
 });
`;

const syntaxBreakPatch = `--- a/src/widget.js
+++ b/src/widget.js
@@ -1 +1 @@
-export function value() { return 1; }
+export function value() { return 1
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
      const testPath = path.join(root, "scripts", "widget.test.ts");
      fs.appendFileSync(testPath, extraTestBody);
      runGit(root, ["add", "scripts/widget.test.ts"]);
      runGit(root, ["commit", "-m", "extra tests"]);
    }
    return root;
  }

  it("(a) correct revert row produces red output and exit 0", () => {
    const root = mkFixture();
    writeRow(root, "99", "good", goodPatch, {
      runner: "vitest",
      testFile: "scripts/widget.test.ts",
      testName: "returns one",
      description: "Break widget return value",
    });
    commitRevertProofs(root);
    const before = snapshotCheckout(root);
    const r = runRevertProof(root, "99", ["--row", "good"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    assertCheckoutUnchanged(root, before);
  });

  it("(b) noop patch stays green fails naming the row", () => {
    const root = mkFixture();
    writeRow(root, "99", "stays-green", noopPatch, {
      runner: "vitest",
      testFile: "scripts/widget.test.ts",
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
      testFile: "scripts/widget.test.ts",
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
      testFile: "scripts/widget.test.ts",
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
      testFile: "scripts/widget.test.ts",
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
      testFile: "scripts/widget.test.ts",
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
    fs.writeFileSync(path.join(root, "scripts", "hang.test.ts"), hangTest);
    runGit(root, ["add", "scripts/hang.test.ts"]);
    runGit(root, ["commit", "-m", "hang test"]);
    writeRow(root, "99", "hang", noopPatch, {
      runner: "vitest",
      testFile: "scripts/hang.test.ts",
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
    fs.writeFileSync(path.join(root, "scripts", "sigint.test.ts"), hangTest);
    runGit(root, ["add", "scripts/sigint.test.ts"]);
    runGit(root, ["commit", "-m", "sigint test"]);
    writeRow(root, "99", "sigint-row", noopPatch, {
      runner: "vitest",
      testFile: "scripts/sigint.test.ts",
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
