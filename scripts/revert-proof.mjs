#!/usr/bin/env node
/**
 * Generate revert-proof evidence for PR bodies.
 * Usage: node scripts/revert-proof.mjs <pr-number> [--row <slug>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function repoRoot() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (r.status === 0 && r.stdout.trim()) {
    return r.stdout.trim();
  }
  return path.resolve(__dirname, "..");
}

const TEST_PATH_RE =
  /(?:^|\/)(?:tests\/|.*\.test\.ts$|.*\.spec\.ts$|test_[^/]*\.py$)/;

/** @type {null | (() => void)} */
let sigintCleanup = null;

function onSigint() {
  if (sigintCleanup) {
    try {
      sigintCleanup();
    } catch {
      /* best effort */
    }
  }
  process.exit(130);
}

process.on("SIGINT", onSigint);

function git(args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: repoRoot(),
    encoding: "utf8",
    ...opts,
  });
  return r;
}

function assertCleanWorktree() {
  const r = git(["status", "--porcelain"]);
  if (r.status !== 0) {
    throw new Error(`git status failed: ${r.stderr || r.stdout}`);
  }
  if (r.stdout.trim() !== "") {
    throw new Error(
      "git worktree is not clean; commit or stash changes before running revert-proof",
    );
  }
}

function listRows(prNumber, onlySlug) {
  const dir = path.join(repoRoot(), "revert-proofs", String(prNumber));
  if (!fs.existsSync(dir)) {
    throw new Error(`revert-proofs directory not found: ${dir}`);
  }
  const patches = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".patch"))
    .map((f) => f.replace(/\.patch$/, ""))
    .sort();
  const slugs = onlySlug ? patches.filter((s) => s === onlySlug) : patches;
  if (onlySlug && slugs.length === 0) {
    throw new Error(`row slug not found: ${onlySlug}`);
  }
  return slugs.map((slug) => {
    const patchPath = path.join(dir, `${slug}.patch`);
    const metaPath = path.join(dir, `${slug}.json`);
    if (!fs.existsSync(metaPath)) {
      throw new Error(`missing sidecar JSON for row ${slug}: ${metaPath}`);
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return { slug, patchPath, metaPath, meta, dir };
  });
}

function pathsTouchedByPatch(patchText) {
  const paths = new Set();
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const p = line.slice(4).replace(/^\w+\//, "").trim();
      if (p === "/dev/null") continue;
      paths.add(p);
    }
  }
  return [...paths];
}

export function patchTouchesTestFiles(patchText) {
  return pathsTouchedByPatch(patchText).some((p) => TEST_PATH_RE.test(p));
}

function validatePatchTouchesOnlyProduction(patchText, slug) {
  if (patchTouchesTestFiles(patchText)) {
    throw new Error(
      `row ${slug}: patch touches test files (only production reverts allowed)`,
    );
  }
}

function vitestBin() {
  const bin = path.join(repoRoot(), "web", "node_modules", ".bin", "vitest");
  if (!fs.existsSync(bin)) {
    throw new Error(
      `vitest not found at ${bin}; run pnpm install in web/ first`,
    );
  }
  return bin;
}

function parseVitestSummary(output) {
  const m = output.match(/Tests\s+([^\n]+)/);
  if (!m) return { ran: 0, failed: 0, passed: 0, raw: "" };
  const part = m[1];
  let failed = 0;
  let passed = 0;
  const failM = part.match(/(\d+)\s+failed/);
  const passM = part.match(/(\d+)\s+passed/);
  if (failM) failed = Number(failM[1]);
  if (passM) passed = Number(passM[1]);
  const ran = failed + passed;
  return { ran, failed, passed, raw: part };
}

function parsePytestSummary(output) {
  const failedM = output.match(/(\d+)\s+failed/);
  const passedM = output.match(/(\d+)\s+passed/);
  const failed = failedM ? Number(failedM[1]) : 0;
  const passed = passedM ? Number(passedM[1]) : 0;
  let ran = failed + passed;
  if (ran === 0) {
    const eq = output.match(/=+\s*(\d+)\s+failed/);
    if (eq) ran = Number(eq[1]);
  }
  return { ran, failed, passed };
}

function splitTestField(testField) {
  const trimmed = testField.trim();
  const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [trimmed];
  return parts.map((p) => p.replace(/^["']|["']$/g, ""));
}

function runRunner(meta, label) {
  const { runner, test: testField } = meta;
  const args = splitTestField(testField);
  if (runner === "vitest") {
    const bin = vitestBin();
    const root = repoRoot();
    const r = spawnSync(
      bin,
      ["run", "--config", path.join(root, "scripts", "vitest.config.mjs"), ...args],
      {
        cwd: path.join(root, "web"),
        encoding: "utf8",
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          REVERT_PROOF_ROOT: root,
        },
      },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const summary = parseVitestSummary(out);
    return {
      command: `${path.relative(repoRoot(), bin)} run ${args.join(" ")}`,
      exitCode: r.status ?? 1,
      output: out,
      summary,
      label,
    };
  }
  if (runner === "pytest") {
    const r = spawnSync("python", ["-m", "pytest", ...args], {
      cwd: repoRoot(),
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const summary = parsePytestSummary(out);
    return {
      command: `python -m pytest ${args.join(" ")}`,
      exitCode: r.status ?? 1,
      output: out,
      summary,
      label,
    };
  }
  throw new Error(`${label}: unknown runner ${runner}`);
}

function trimFailureOutput(output, maxLines = 40) {
  const lines = output.split("\n");
  const keep = new Set();
  const patterns = [
    /FAIL|Error|AssertionError|Expected|received|assert/i,
    /✓|×|❯|⎯|failed|Error:/,
    /^\s+at /,
  ];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
        keep.add(j);
      }
    }
  }
  if (keep.size === 0) {
    return lines.slice(-maxLines).join("\n").trim();
  }
  const ordered = [...keep].sort((a, b) => a - b);
  const picked = [];
  for (const idx of ordered) {
    picked.push(lines[idx]);
    if (picked.length >= maxLines) break;
  }
  return picked.join("\n").trim();
}

function applyPatch(patchPath) {
  const check = git(["apply", "--check", patchPath]);
  if (check.status !== 0) {
    throw new Error(
      `git apply --check failed: ${check.stderr || check.stdout}`,
    );
  }
  const apply = git(["apply", patchPath]);
  if (apply.status !== 0) {
    throw new Error(`git apply failed: ${apply.stderr || apply.stdout}`);
  }
}

function reversePatch(patchPath) {
  const r = git(["apply", "-R", patchPath]);
  if (r.status !== 0) {
    throw new Error(`git apply -R failed: ${r.stderr || r.stdout}`);
  }
}

function runRow(row) {
  const { slug, patchPath, meta } = row;
  const patchText = fs.readFileSync(patchPath, "utf8");
  validatePatchTouchesOnlyProduction(patchText, slug);

  const baseline = runRunner(meta, `row ${slug} (baseline)`);
  if (baseline.exitCode !== 0 || baseline.summary.ran < 1) {
    throw new Error(
      `row ${slug}: baseline test must PASS with at least 1 test run (exit=${baseline.exitCode}, ran=${baseline.summary.ran})`,
    );
  }

  let patched = null;
  sigintCleanup = () => {
    try {
      reversePatch(patchPath);
    } catch {
      /* ignore */
    }
    assertCleanWorktree();
  };

  try {
    applyPatch(patchPath);
    patched = runRunner(meta, `row ${slug} (patched)`);
  } finally {
    try {
      reversePatch(patchPath);
    } finally {
      sigintCleanup = null;
      assertCleanWorktree();
    }
  }

  if (patched.summary.ran < 1) {
    throw new Error(
      `row ${slug}: patched run matched zero tests (filter too narrow?)`,
    );
  }
  if (patched.exitCode === 0) {
    throw new Error(
      `row ${slug}: test stayed GREEN after revert patch (expected failure)`,
    );
  }

  return {
    slug,
    test: meta.test,
    description: meta.description ?? "",
    command: patched.command,
    result: "RED (expected)",
    failureOutput: trimFailureOutput(patched.output),
    baseline,
    patched,
  };
}

function escapeCell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildReport(results, errors) {
  const lines = [];
  lines.push("## Revert proof");
  lines.push("");
  lines.push(
    "| row | test | revert description | command | result |",
  );
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of results) {
    lines.push(
      `| ${escapeCell(r.slug)} | ${escapeCell(r.test)} | ${escapeCell(r.description)} | ${escapeCell(r.command)} | ${escapeCell(r.result)} |`,
    );
  }
  for (const e of errors) {
    lines.push(
      `| ${escapeCell(e.slug)} | | | | **ERROR: ${escapeCell(e.message)}** |`,
    );
  }
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.slug}`);
    lines.push("");
    lines.push("```");
    lines.push(r.failureOutput || "(no output captured)");
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const pr = argv[2];
  if (!pr || pr.startsWith("-")) {
    console.error("Usage: node scripts/revert-proof.mjs <pr-number> [--row <slug>]");
    process.exit(2);
  }
  let row = null;
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === "--row" && argv[i + 1]) {
      row = argv[++i];
    }
  }
  return { prNumber: pr, row };
}

function main() {
  const { prNumber, row: onlySlug } = parseArgs(process.argv);
  assertCleanWorktree();

  const rows = listRows(prNumber, onlySlug);
  const results = [];
  const errors = [];

  for (const row of rows) {
    try {
      results.push(runRow(row));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ slug: row.slug, message });
      console.error(message);
    }
  }

  const report = buildReport(results, errors);
  const reportPath = path.join(
    repoRoot(),
    "revert-proofs",
    String(prNumber),
    "REPORT.md",
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(report);

  if (errors.length > 0) {
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
