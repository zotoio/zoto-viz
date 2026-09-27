#!/usr/bin/env node
/**
 * Generate revert-proof evidence for PR bodies.
 * Usage: node scripts/revert-proof.mjs <pr-number> [--row <slug>]
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_SEC = 120;

const TEST_PATH_RE =
  /(?:^|\/)(?:tests\/|.*\.test\.ts$|.*\.spec\.ts$|test_[^/]*\.py$)/;

const DEP_EXCLUDE = ["node_modules", "web/node_modules", ".venv"];

/** @type {null | (() => void)} */
let globalCleanup = null;

function onSignal() {
  if (globalCleanup) {
    try {
      globalCleanup();
    } catch {
      /* best effort */
    }
  }
  process.exit(130);
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

function mainCheckoutRoot() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (r.status === 0 && r.stdout.trim()) {
    return r.stdout.trim();
  }
  return path.resolve(__dirname, "..");
}

function gitAt(root, args, opts = {}) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    ...opts,
  });
}

function checkoutSnapshot(root) {
  const head = gitAt(root, ["rev-parse", "HEAD"]);
  const status = gitAt(root, ["status", "--porcelain"]);
  if (head.status !== 0 || status.status !== 0) {
    throw new Error("failed to snapshot checkout state");
  }
  return {
    head: head.stdout.trim(),
    porcelain: status.stdout,
  };
}

function porcelainDiffAllowed(before, after, prNumber) {
  const reportSuffix = `revert-proofs/${prNumber}/REPORT.md`;
  const filter = (text) =>
    text
      .split("\n")
      .filter((line) => line.trim() && !line.includes(reportSuffix))
      .join("\n");
  return filter(before) === filter(after);
}

function assertCheckoutUnchanged(root, before, prNumber) {
  const after = checkoutSnapshot(root);
  if (before.head !== after.head) {
    throw new Error(
      `checkout HEAD changed during revert-proof (${before.head} -> ${after.head})`,
    );
  }
  if (!porcelainDiffAllowed(before.porcelain, after.porcelain, prNumber)) {
    throw new Error(
      "checkout worktree changed during revert-proof (only REPORT.md may differ)",
    );
  }
}

function listRows(mainRoot, prNumber, onlySlug) {
  const dir = path.join(mainRoot, "revert-proofs", String(prNumber));
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

/** Escape a literal for vitest `-t` (RegExp); does not add anchors. */
export function escapeVitestTestNamePattern(testName) {
  return testName.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * Vitest `-t` matches `fullTestName` (`describe > … > test`), not the short title alone.
 * Anchor so a prefix cannot select multiple tests.
 */
export function vitestTestNamePattern(fullTestName) {
  return `^${escapeVitestTestNamePattern(fullTestName)}$`;
}

/** Pytest node id: `file.py::Class::test` or `file.py::test[param]` (never `-k`). */
export function pytestNodeId(testFile, testName) {
  const file = testFile.replace(/\\/g, "/");
  if (testName.includes("/")) {
    throw new Error("testName must be the pytest node suffix, not a file path");
  }
  if (testName.startsWith(`${file}::`)) {
    return testName;
  }
  return `${file}::${testName}`;
}

function validateMeta(meta, slug) {
  for (const key of ["runner", "testFile", "testName", "description"]) {
    if (!meta[key] || typeof meta[key] !== "string") {
      throw new Error(`row ${slug}: sidecar JSON missing string field "${key}"`);
    }
  }
  if (meta.runner !== "vitest" && meta.runner !== "pytest") {
    throw new Error(`row ${slug}: runner must be vitest or pytest`);
  }
}

function validatePatchTouchesOnlyProduction(patchText, slug) {
  if (patchTouchesTestFiles(patchText)) {
    throw new Error(
      `row ${slug}: patch touches test files (only production reverts allowed)`,
    );
  }
}

function resolveVitest(wtRoot, testFile) {
  const rel = testFile.replace(/\\/g, "/");
  const rootBin = path.join(wtRoot, "node_modules", ".bin", "vitest");
  const webBin = path.join(wtRoot, "web", "node_modules", ".bin", "vitest");
  if (!rel.startsWith("web/") && fs.existsSync(rootBin)) {
    return { bin: rootBin, cwd: wtRoot };
  }
  if (fs.existsSync(webBin)) {
    return { bin: webBin, cwd: path.join(wtRoot, "web") };
  }
  if (fs.existsSync(rootBin)) {
    return { bin: rootBin, cwd: wtRoot };
  }
  throw new Error(
    `vitest not found under ${wtRoot} (run pnpm install --offline in the worktree first)`,
  );
}

function tscBin(wtRoot) {
  const bin = path.join(wtRoot, "web", "node_modules", ".bin", "tsc");
  if (!fs.existsSync(bin)) {
    return null;
  }
  return bin;
}

const SKIP_WALK = new Set([".git", "node_modules", ".venv", "revert-proofs"]);

function findPnpmLockRoots(wtRoot) {
  const roots = [];
  function walk(dir) {
    const base = path.basename(dir);
    if (SKIP_WALK.has(base)) {
      return;
    }
    if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) {
      roots.push(dir);
    }
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name));
      }
    }
  }
  walk(wtRoot);
  return roots;
}

function pnpmInstallOffline(cwd) {
  const r = spawnSync(
    "pnpm",
    ["install", "--offline", "--frozen-lockfile"],
    {
      cwd,
      encoding: "utf8",
      env: process.env,
    },
  );
  if (r.status !== 0) {
    throw new Error(
      `pnpm install --offline --frozen-lockfile failed in ${cwd} (no fallback to linking node_modules): ${r.stderr || r.stdout}`,
    );
  }
}

function findNodeModulesRoots(wtRoot) {
  const roots = [];
  function walk(dir, depth) {
    if (depth > 6) {
      return;
    }
    const nm = path.join(dir, "node_modules");
    if (fs.existsSync(nm)) {
      roots.push(nm);
    }
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name === "node_modules" || SKIP_WALK.has(ent.name)) {
        continue;
      }
      walk(path.join(dir, ent.name), depth + 1);
    }
  }
  walk(wtRoot, 0);
  return roots;
}

function checkSymlinkInsideWorktree(linkPath, wtReal) {
  let st;
  try {
    st = fs.lstatSync(linkPath);
  } catch {
    return;
  }
  if (!st.isSymbolicLink()) {
    return;
  }
  const real = fs.realpathSync(linkPath);
  if (real !== wtReal && !real.startsWith(`${wtReal}${path.sep}`)) {
    throw new Error(
      `workspace link ${linkPath} resolves outside worktree: ${real}`,
    );
  }
}

export function assertWorkspaceLinksInWorktree(wtRoot) {
  const wtReal = fs.realpathSync(wtRoot);
  for (const nmRoot of findNodeModulesRoots(wtRoot)) {
    for (const name of fs.readdirSync(nmRoot)) {
      if (name === ".pnpm" || name === ".bin" || name === ".cache") {
        continue;
      }
      const full = path.join(nmRoot, name);
      if (name.startsWith("@")) {
        let scopeStat;
        try {
          scopeStat = fs.statSync(full);
        } catch {
          continue;
        }
        if (!scopeStat.isDirectory()) {
          checkSymlinkInsideWorktree(full, wtReal);
          continue;
        }
        for (const pkg of fs.readdirSync(full)) {
          checkSymlinkInsideWorktree(path.join(full, pkg), wtReal);
        }
        continue;
      }
      checkSymlinkInsideWorktree(full, wtReal);
    }
  }
}

let worktreeJsDepsReady = false;

function findPnpmInstallRoots(wtRoot, rows) {
  if (!rows.some((r) => r.meta.runner === "vitest")) {
    return [];
  }
  const roots = [];
  const webDir = path.join(wtRoot, "web");
  const webLock = path.join(webDir, "pnpm-lock.yaml");
  const rootLock = path.join(wtRoot, "pnpm-lock.yaml");
  if (fs.existsSync(webLock)) {
    roots.push(webDir);
  }
  if (fs.existsSync(rootLock) && !roots.includes(wtRoot)) {
    roots.push(wtRoot);
  }
  if (roots.length === 0) {
    throw new Error(
      "vitest rows require pnpm-lock.yaml at repo root or web/ in the worktree",
    );
  }
  return roots;
}

function ensureJsDepsInWorktree(wtRoot, rows) {
  if (worktreeJsDepsReady) {
    return;
  }
  for (const dir of findPnpmInstallRoots(wtRoot, rows)) {
    pnpmInstallOffline(dir);
  }
  if (rows.some((r) => r.meta.runner === "vitest")) {
    assertWorkspaceLinksInWorktree(wtRoot);
  }
  worktreeJsDepsReady = true;
}

function venvPython(mainRoot) {
  const candidates = [
    path.join(mainRoot, ".venv", "bin", "python"),
    path.join(mainRoot, ".venv", "Scripts", "python.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return process.env.PYTHON ?? "python3";
}

function pythonEnvForWorktree(wtRoot) {
  return {
    ...process.env,
    PYTHONPATH: wtRoot,
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

function clearPythonBytecodeCaches(wtRoot) {
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".git" || ent.name === "node_modules" || ent.name === ".venv") {
        continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "__pycache__") {
          fs.rmSync(full, { recursive: true, force: true });
          continue;
        }
        walk(full);
      }
    }
  }
  walk(wtRoot);
}

export function assertEditablePythonResolvesInWorktree(
  wtRoot,
  python,
  moduleName = "service",
) {
  const r = spawnSync(
    python,
    [
      "-c",
      `import ${moduleName},os;print(os.path.realpath(${moduleName}.__file__))`,
    ],
    {
      cwd: wtRoot,
      env: pythonEnvForWorktree(wtRoot),
      encoding: "utf8",
    },
  );
  if (r.status !== 0) {
    throw new Error(
      `python import check for ${moduleName} failed: ${r.stderr || r.stdout}`,
    );
  }
  const resolved = r.stdout.trim();
  const wtReal = fs.realpathSync(wtRoot);
  if (resolved !== wtReal && !resolved.startsWith(`${wtReal}${path.sep}`)) {
    throw new Error(
      `editable Python package ${moduleName} resolves outside worktree (${resolved})`,
    );
  }
}

let pythonIsolationChecked = false;

function ensurePythonIsolation(mainRoot, wtRoot, moduleName) {
  if (pythonIsolationChecked) {
    return;
  }
  const python = venvPython(mainRoot);
  assertEditablePythonResolvesInWorktree(wtRoot, python, moduleName);
  pythonIsolationChecked = true;
}

function resetWorktree(wtRoot) {
  const hard = gitAt(wtRoot, ["reset", "--hard", "HEAD"]);
  if (hard.status !== 0) {
    throw new Error(`git reset --hard failed: ${hard.stderr || hard.stdout}`);
  }
  const cleanArgs = ["clean", "-fdx", ...DEP_EXCLUDE.flatMap((e) => ["-e", e])];
  const clean = gitAt(wtRoot, cleanArgs);
  if (clean.status !== 0) {
    throw new Error(`git clean failed: ${clean.stderr || clean.stdout}`);
  }
}

function addDetachedWorktree(mainRoot, wtPath, head) {
  if (fs.existsSync(wtPath)) {
    removeWorktree(mainRoot, wtPath);
  }
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  const r = gitAt(mainRoot, ["worktree", "add", "--detach", wtPath, head]);
  if (r.status !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr || r.stdout}`);
  }
}

function removeWorktree(mainRoot, wtPath) {
  if (!fs.existsSync(wtPath)) {
    return;
  }
  const rm = gitAt(mainRoot, ["worktree", "remove", "--force", wtPath]);
  if (rm.status !== 0) {
    fs.rmSync(wtPath, { recursive: true, force: true });
    gitAt(mainRoot, ["worktree", "prune"]);
  }
}

function runProcess(cmd, args, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    let timedOut = false;
    const timeoutMs = options.timeoutMs;
    let timer;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
        output: `${stdout}${stderr}`,
      });
    });
  });
}

function countVitestExecuted(report) {
  let executed = 0;
  let passed = 0;
  let failed = 0;
  const failedAssertions = [];
  if (!report?.testResults?.length) {
    return {
      executed: 0,
      passed: 0,
      failed: 0,
      suiteError: report ? "no tests executed" : "no JSON report",
      failedAssertions: [],
    };
  }
  for (const file of report.testResults ?? []) {
    if (file.status === "failed" && (!file.assertionResults || file.assertionResults.length === 0)) {
      return {
        executed: 0,
        passed: 0,
        failed: 0,
        suiteError: file.message || "suite failed",
        failedAssertions: [],
      };
    }
    for (const t of file.assertionResults ?? []) {
      if (t.status === "skipped" || t.status === "pending" || t.status === "todo") {
        continue;
      }
      executed += 1;
      if (t.status === "passed") passed += 1;
      if (t.status === "failed") {
        failed += 1;
        failedAssertions.push({
          name: t.fullName || t.title,
          messages: t.failureMessages ?? [],
        });
      }
    }
  }
  return { executed, passed, failed, suiteError: null, failedAssertions };
}

function isVitestAssertionFailure(failedAssertions) {
  if (!failedAssertions.length) return false;
  const text = failedAssertions
    .flatMap((f) => f.messages)
    .join("\n");
  return (
    /AssertionError|expect\(|Expected|Received|toBe|toEqual/i.test(text) ||
    failedAssertions.some((f) => f.messages.length > 0)
  );
}

function parsePytestJunit(xmlText) {
  const cases = [];
  const caseRe = /<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xmlText))) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const nameM = attrs.match(/\bname="([^"]*)"/);
    const name = nameM ? nameM[1] : "";
    if (/<skipped\b/.test(body)) continue;
    let outcome = "passed";
    if (/<failure\b/.test(body)) outcome = "failed";
    else if (/<error\b/.test(body)) outcome = "error";
    cases.push({ name, outcome, body });
  }
  const collectionErrors = /<collection errors="(\d+)"/.exec(xmlText);
  if (collectionErrors && Number(collectionErrors[1]) > 0) {
    return { executed: 0, cases, collectionError: true };
  }
  return { executed: cases.length, cases, collectionError: false };
}

async function runVitest(wtRoot, meta, slug, phase, timeoutMs, artifactsDir) {
  const { bin, cwd } = resolveVitest(wtRoot, meta.testFile);
  const testRel = meta.testFile.replace(/^web\//, "");
  const jsonOut = path.join(artifactsDir, `${slug}-${phase}-vitest.json`);
  const testPattern = vitestTestNamePattern(meta.testName);
  const args = [
    "run",
    "--config",
    path.join(wtRoot, "scripts", "vitest.config.mjs"),
    testRel,
    "-t",
    testPattern,
    "--reporter=json",
    `--outputFile=${jsonOut}`,
  ];
  const result = await runProcess(bin, args, {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      REVERT_PROOF_ROOT: wtRoot,
    },
    timeoutMs,
  });
  let report = null;
  if (fs.existsSync(jsonOut)) {
    report = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
  }
  const counts = report
    ? countVitestExecuted(report)
    : { executed: 0, passed: 0, failed: 0, suiteError: "no JSON report", failedAssertions: [] };
  return {
    command: `${path.relative(wtRoot, bin)} run ${meta.testFile} -t ${JSON.stringify(meta.testName)}`,
    ...result,
    counts,
    reportPath: jsonOut,
  };
}

async function runPytest(
  mainRoot,
  wtRoot,
  meta,
  slug,
  phase,
  timeoutMs,
  artifactsDir,
) {
  const xmlOut = path.join(artifactsDir, `${slug}-${phase}-pytest.xml`);
  const python = venvPython(mainRoot);
  const nodeId = pytestNodeId(meta.testFile, meta.testName);
  const args = [
    "-m",
    "pytest",
    nodeId,
    `--junitxml=${xmlOut}`,
    "-o",
    "addopts=",
  ];
  const result = await runProcess(python, args, {
    cwd: wtRoot,
    env: { ...pythonEnvForWorktree(wtRoot), FORCE_COLOR: "0" },
    timeoutMs,
  });
  let parsed = { executed: 0, cases: [], collectionError: false };
  if (fs.existsSync(xmlOut)) {
    parsed = parsePytestJunit(fs.readFileSync(xmlOut, "utf8"));
  }
  return {
    command: `python -m pytest ${nodeId}`,
    ...result,
    counts: parsed,
    reportPath: xmlOut,
  };
}

async function runTestPhase(
  mainRoot,
  wtRoot,
  meta,
  slug,
  phase,
  timeoutMs,
  artifactsDir,
) {
  if (meta.runner === "vitest") {
    return runVitest(wtRoot, meta, slug, phase, timeoutMs, artifactsDir);
  }
  return runPytest(mainRoot, wtRoot, meta, slug, phase, timeoutMs, artifactsDir);
}

function runTscCheck(wtRoot) {
  const bin = tscBin(wtRoot);
  const tsconfig = path.join(wtRoot, "web", "tsconfig.json");
  if (!bin || !fs.existsSync(tsconfig)) {
    return { ok: true, skipped: true, output: "" };
  }
  const r = spawnSync(bin, ["--noEmit", "-p", tsconfig], {
    cwd: wtRoot,
    encoding: "utf8",
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0, skipped: false, output };
}

const GIT_APPLY_OPTS = ["--whitespace=error", "-C1"];

function findPatchArtifactFiles(wtRoot) {
  const found = [];
  const skip = new Set([".git", "node_modules", "web/node_modules", ".venv"]);
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) {
        continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (ent.name.endsWith(".rej") || ent.name.endsWith(".orig")) {
        found.push(full);
      }
    }
  }
  walk(wtRoot);
  return found;
}

function removePatchArtifactFiles(wtRoot) {
  for (const f of findPatchArtifactFiles(wtRoot)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* best effort */
    }
  }
}

function applyPatch(wtRoot, patchPath) {
  const check = gitAt(wtRoot, ["apply", "--check", ...GIT_APPLY_OPTS, patchPath]);
  if (check.status !== 0) {
    throw new Error(
      `git apply --check failed: ${check.stderr || check.stdout}`,
    );
  }
  const apply = gitAt(wtRoot, ["apply", ...GIT_APPLY_OPTS, patchPath]);
  if (apply.status !== 0) {
    removePatchArtifactFiles(wtRoot);
    throw new Error(`git apply failed: ${apply.stderr || apply.stdout}`);
  }
  const artifacts = findPatchArtifactFiles(wtRoot);
  if (artifacts.length > 0) {
    removePatchArtifactFiles(wtRoot);
    throw new Error(
      `git apply left patch artifacts: ${artifacts.map((p) => path.relative(wtRoot, p)).join(", ")}`,
    );
  }
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

function assertExactlyOneTest(slug, phase, run) {
  if (run.timedOut) {
    throw new Error(`row ${slug}: ${phase} timed out`);
  }
  const executed = metaRunnerCount(run);
  if (executed === 0) {
    throw new Error(
      `row ${slug}: ${phase} ran 0 tests (selection/filter error; never a pass)`,
    );
  }
  if (executed !== 1) {
    throw new Error(
      `row ${slug}: ${phase} must run exactly 1 test (got ${executed})`,
    );
  }
}

function metaRunnerCount(run) {
  if (run.counts.executed !== undefined && run.counts.collectionError !== undefined) {
    if (run.counts.collectionError) return 0;
    return run.counts.executed;
  }
  if (run.counts.suiteError) return 0;
  return run.counts.executed;
}

export function rejectPatchedVitestGreen(kind, slug) {
  if (kind === "green") {
    throw new Error(
      `row ${slug}: test stayed GREEN after revert patch (expected failure)`,
    );
  }
}

function classifyPatchedVitest(run) {
  if (run.counts.suiteError) {
    return "build break";
  }
  if (run.counts.failed !== 1) {
    return "not single assertion failure";
  }
  if (!isVitestAssertionFailure(run.counts.failedAssertions)) {
    return "build break";
  }
  return "assertion";
}

function classifyPatchedPytest(run) {
  if (run.counts.collectionError) return "build break";
  const cases = run.counts.cases ?? [];
  if (cases.length !== 1) return "not single test";
  const c = cases[0];
  if (c.outcome === "error") return "build break";
  if (c.outcome === "failed") return "assertion";
  if (c.outcome === "passed") return "green";
  return "unknown";
}

async function runRow(mainRoot, wtRoot, row, artifactsDir) {
  const { slug, patchPath, meta } = row;
  validateMeta(meta, slug);
  const patchText = fs.readFileSync(patchPath, "utf8");
  validatePatchTouchesOnlyProduction(patchText, slug);

  const timeoutMs = (meta.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const testLabel = `${meta.testFile} :: ${meta.testName}`;

  resetWorktree(wtRoot);

  if (meta.runner === "pytest") {
    ensurePythonIsolation(
      mainRoot,
      wtRoot,
      meta.pythonModule ?? "service",
    );
  }

  const baseline = await runTestPhase(
    mainRoot,
    wtRoot,
    meta,
    slug,
    "baseline",
    timeoutMs,
    artifactsDir,
  );
  if (baseline.timedOut) {
    throw new Error(`row ${slug}: baseline timed out`);
  }
  assertExactlyOneTest(slug, "baseline", baseline);
  if (meta.runner === "vitest") {
    if (baseline.counts.failed > 0 || baseline.counts.passed !== 1) {
      throw new Error(`row ${slug}: baseline test must PASS`);
    }
  } else if (baseline.counts.cases?.[0]?.outcome !== "passed") {
    throw new Error(`row ${slug}: baseline test must PASS`);
  }

  try {
    applyPatch(wtRoot, patchPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`row ${slug}: ${msg}`);
  }
  if (meta.runner === "pytest") {
    clearPythonBytecodeCaches(wtRoot);
  }

  let tscNote = "";
  if (meta.runner === "vitest") {
    const tsc = runTscCheck(wtRoot);
    if (!tsc.ok && !tsc.skipped) {
      if (meta.allowTypeError) {
        tscNote = `allowTypeError: ${meta.allowTypeErrorReason ?? meta.allowTypeError ?? "yes"}`;
      } else {
        throw new Error(
          `row ${slug}: patch breaks build (tsc --noEmit -p web failed; proves nothing)`,
        );
      }
    }
  }

  const patched = await runTestPhase(
    mainRoot,
    wtRoot,
    meta,
    slug,
    "patched",
    timeoutMs,
    artifactsDir,
  );
  if (patched.timedOut) {
    throw new Error(`row ${slug}: patched run timed out (not counted as red)`);
  }

  const patchedCount = metaRunnerCount(patched);
  if (patchedCount === 0 && (patched.counts.suiteError || patched.counts.collectionError)) {
    throw new Error(
      `row ${slug}: patch breaks build (proves nothing)`,
    );
  }
  assertExactlyOneTest(slug, "patched", patched);

  if (meta.runner === "vitest") {
    const kind = classifyPatchedVitest(patched);
    rejectPatchedVitestGreen(kind, slug);
    if (kind === "build break" || kind === "not single assertion failure") {
      throw new Error(
        `row ${slug}: patch breaks build or fails without assertion (proves nothing)`,
      );
    }
  } else {
    const kind = classifyPatchedPytest(patched);
    if (kind === "green") {
      throw new Error(
        `row ${slug}: test stayed GREEN after revert patch (expected failure)`,
      );
    }
    if (kind === "build break" || kind === "not single test") {
      throw new Error(
        `row ${slug}: patch breaks build or pytest error (proves nothing)`,
      );
    }
  }

  const failureText = vitestFailureSnippet(patched.reportPath, patched.output);

  return {
    slug,
    test: testLabel,
    description: meta.description,
    command: patched.command,
    result: tscNote ? `RED (expected; ${tscNote})` : "RED (expected)",
    failureOutput: failureText,
    allowTypeErrorNote: tscNote,
  };
}

function vitestFailureSnippet(reportPath, fallbackOutput) {
  if (reportPath && fs.existsSync(reportPath) && reportPath.endsWith(".json")) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      const parts = [];
      for (const file of report.testResults ?? []) {
        for (const t of file.assertionResults ?? []) {
          if (t.status === "failed") {
            parts.push(...(t.failureMessages ?? []));
          }
        }
        if (file.message) parts.push(file.message);
      }
      if (parts.length) {
        return trimFailureOutput(parts.join("\n"));
      }
    } catch {
      /* fall through */
    }
  }
  return trimFailureOutput(fallbackOutput);
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

async function mainAsync() {
  worktreeJsDepsReady = false;
  pythonIsolationChecked = false;

  const { prNumber, row: onlySlug } = parseArgs(process.argv);
  const mainRoot = mainCheckoutRoot();
  const before = checkoutSnapshot(mainRoot);

  if (before.porcelain.trim()) {
    console.warn(
      "warning: checkout has uncommitted changes; revert-proof rows use HEAD only (uncommitted work is not included)",
    );
  }

  const head = before.head;
  const rows = listRows(mainRoot, prNumber, onlySlug);
  const wtPath = path.join(
    os.tmpdir(),
    `revert-proof-wt-${path.basename(mainRoot)}-${process.pid}`,
  );
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "revert-proof-artifacts-"));

  const results = [];
  const errors = [];

  globalCleanup = () => {
    removeWorktree(mainRoot, wtPath);
    gitAt(mainRoot, ["worktree", "prune"]);
  };

  try {
    addDetachedWorktree(mainRoot, wtPath, head);
    ensureJsDepsInWorktree(wtPath, rows);

    for (const row of rows) {
      try {
        results.push(await runRow(mainRoot, wtPath, row, artifactsDir));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ slug: row.slug, message });
        console.error(message);
        try {
          resetWorktree(wtPath);
        } catch {
          /* continue */
        }
      }
    }
  } finally {
    globalCleanup();
    globalCleanup = null;
    fs.rmSync(artifactsDir, { recursive: true, force: true });
    try {
      assertCheckoutUnchanged(mainRoot, before, prNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(1);
    }
  }

  const report = buildReport(results, errors);
  const reportPath = path.join(
    mainRoot,
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
  mainAsync().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
