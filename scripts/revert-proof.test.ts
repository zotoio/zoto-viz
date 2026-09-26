import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "revert-proof.mjs");

function runGit(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
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
  meta: { runner: string; test: string; description: string },
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

function expectOnlyReportDirty(root: string, pr = "99") {
  const status = runGit(root, ["status", "--porcelain"]).trim();
  const lines = status ? status.split("\n") : [];
  expect(lines.every((l) => l.includes(`revert-proofs/${pr}/REPORT.md`))).toBe(true);
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

describe("revert-proof runner (fixture repo)", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const t of temps.splice(0)) {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  function mkFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "revert-proof-"));
    temps.push(root);
    writeFixtureRepo(root);
    return root;
  }

  it("correct revert row produces red output and exit 0", () => {
    const root = mkFixture();
    writeRow(root, "99", "good", goodPatch, {
      runner: "vitest",
      test: "scripts/widget.test.ts -t returns one",
      description: "Break widget return value",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("RED (expected)");
    expect(fs.existsSync(path.join(root, "revert-proofs", "99", "REPORT.md"))).toBe(
      true,
    );
    expectOnlyReportDirty(root);
  });

  it("row whose revert does not break the test exits 1 naming the row", () => {
    const root = mkFixture();
    writeRow(root, "99", "stays-green", noopPatch, {
      runner: "vitest",
      test: "scripts/widget.test.ts -t returns one",
      description: "No-op revert",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99");
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row stays-green/);
    expectOnlyReportDirty(root);
  });

  it("rejects patch touching test files", () => {
    const root = mkFixture();
    writeRow(root, "99", "touch-test", testTouchPatch, {
      runner: "vitest",
      test: "scripts/widget.test.ts -t returns one",
      description: "Illegal test edit",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99");
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row touch-test.*test files/i);
    expectOnlyReportDirty(root);
  });

  it("rejects filter matching zero tests", () => {
    const root = mkFixture();
    writeRow(root, "99", "no-match", goodPatch, {
      runner: "vitest",
      test: "scripts/widget.test.ts -t does-not-exist",
      description: "Narrow filter",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99");
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/row no-match/);
    expectOnlyReportDirty(root);
  });

  it("leaves tree clean when baseline throws", () => {
    const root = mkFixture();
    writeRow(root, "99", "broken-baseline", goodPatch, {
      runner: "vitest",
      test: "scripts/missing.test.ts -t x",
      description: "Missing test file",
    });
    commitRevertProofs(root);
    const r = runRevertProof(root, "99");
    expect(r.status).toBe(1);
    expectOnlyReportDirty(root);
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
