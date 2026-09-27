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
import {
  allowTypeErrorEnabled,
  assertEditablePythonResolvesInWorktree,
  assertWorkspaceLinksInWorktree,
  assessPytestSelection,
  assessVitestSelection,
  assertRedValue,
  assertVitestNodeAssertFailClosed,
  gitApplyPatchStrict,
  buildPytestArgv,
  classifyPatchedPytest,
  classifyPatchedVitest,
  parsePytestPluginJson,
  parseTimeoutSec,
  parseVitestJsonReport,
  pytestArgvUsesNodeIdNotK,
  pytestNodeId,
  pythonEnvForWorktree,
  rejectPatchedVitestGreen,
  resolveVitestProject,
  sanitizeReportText,
  validatePatchProductionReachable,
  validatePatchStructure,
  validatePatchTouchesOnlyProduction,
  validatePrNumber,
  validatePythonModule,
  validateRowMeta,
  validateTestFileRel,
  vitestTestNamePattern,
} from "./revert-proof-lib.mjs";

const REVERT_PROOF_PYTEST_PLUGIN_MODULE = "revert_proof_pytest_plugin";

function revertProofScriptsDir(wtRoot) {
  return path.join(wtRoot, "scripts");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_SEC = 120;

const DEP_EXCLUDE = ["node_modules", "web/node_modules", ".venv"];

/** @type {null | (() => void)} */
let globalCleanup = null;
/** @type {import("node:child_process").ChildProcess | null} */
let activeTestChild = null;
/** @type {string | null} */
let activeArtifactsDir = null;

function onSignal() {
  if (activeTestChild?.pid) {
    killProcessGroup(activeTestChild);
    activeTestChild = null;
  }
  if (globalCleanup) {
    try {
      globalCleanup();
    } catch {
      /* best effort */
    }
  }
  if (activeArtifactsDir && fs.existsSync(activeArtifactsDir)) {
    try {
      fs.rmSync(activeArtifactsDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    activeArtifactsDir = null;
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

function readGitHeadFile(mainRoot, relPath) {
  const r = gitAt(mainRoot, ["show", `HEAD:${relPath}`]);
  if (r.status !== 0) {
    throw new Error(`missing at HEAD: ${relPath} (${r.stderr || r.stdout})`);
  }
  return r.stdout;
}

function listRows(mainRoot, prNumber, onlySlug) {
  const prefix = `revert-proofs/${prNumber}`;
  const ls = gitAt(mainRoot, ["ls-tree", "--name-only", "HEAD", `${prefix}/`]);
  if (ls.status !== 0 || !ls.stdout.trim()) {
    throw new Error(`revert-proofs directory not found at HEAD: ${prefix}`);
  }
  const patches = ls.stdout
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.endsWith(".patch"))
    .map((p) => path.basename(p).replace(/\.patch$/, ""))
    .sort();
  const slugs = onlySlug ? patches.filter((s) => s === onlySlug) : patches;
  if (onlySlug && slugs.length === 0) {
    throw new Error(`row slug not found: ${onlySlug}`);
  }
  return slugs.map((slug) => {
    const relPatch = `${prefix}/${slug}.patch`;
    const relMeta = `${prefix}/${slug}.json`;
    const patchText = readGitHeadFile(mainRoot, relPatch);
    const meta = JSON.parse(readGitHeadFile(mainRoot, relMeta));
    return {
      slug,
      patchPath: path.join(mainRoot, relPatch),
      patchText,
      metaPath: path.join(mainRoot, relMeta),
      meta,
      dir: path.join(mainRoot, prefix),
    };
  });
}

function tscBin(wtRoot) {
  const bin = path.join(wtRoot, "web", "node_modules", ".bin", "tsc");
  if (!fs.existsSync(bin)) {
    return null;
  }
  return bin;
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

function vitestBinsPresent(wtRoot) {
  const rootBin = path.join(wtRoot, "node_modules", ".bin", "vitest");
  const webBin = path.join(wtRoot, "web", "node_modules", ".bin", "vitest");
  return fs.existsSync(rootBin) || fs.existsSync(webBin);
}

function ensureJsDepsInWorktree(_mainRoot, wtRoot, rows) {
  if (worktreeJsDepsReady) {
    return;
  }
  const needsVitest = rows.some((r) => r.meta.runner === "vitest");
  const installRoots = needsVitest ? findPnpmInstallRoots(wtRoot, rows) : [];
  if (installRoots.length > 0) {
    for (const dir of installRoots) {
      pnpmInstallOffline(dir);
    }
  } else if (needsVitest && !vitestBinsPresent(wtRoot)) {
    throw new Error(
      "vitest rows require pnpm-lock.yaml and offline install in the worktree",
    );
  }
  if (needsVitest) {
    assertWorkspaceLinksInWorktree(wtRoot);
  }
  worktreeJsDepsReady = true;
}

function venvPython(mainRoot) {
  if (process.env.REVERT_PROOF_PYTHON) {
    return process.env.REVERT_PROOF_PYTHON;
  }
  const candidates = [
    path.join(mainRoot, ".venv", "bin", "python3"),
    path.join(mainRoot, ".venv", "bin", "python"),
    path.join(mainRoot, ".venv", "Scripts", "python.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return "python3";
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

function killProcessGroup(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* best effort */
    }
  }
}

function runProcess(cmd, args, options) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    activeTestChild = child;
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
        killProcessGroup(child);
      }, timeoutMs);
    }
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (activeTestChild === child) {
        activeTestChild = null;
      }
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

function summarizeVitestCounts(parsed, testName) {
  const selection = assessVitestSelection(parsed.tests, testName);
  const executed = parsed.tests.filter(
    (t) => !["skipped", "pending", "todo"].includes(t.status),
  ).length;
  const target = selection.target;
  const passed = target?.status === "passed" ? 1 : 0;
  const failed = target?.status === "failed" ? 1 : 0;
  return {
    executed,
    passed,
    failed,
    suiteError: parsed.suiteError,
    selection,
    tests: parsed.tests,
  };
}

function summarizePytestCounts(parsed, nodeId) {
  const selection = assessPytestSelection(parsed.tests, nodeId);
  const executed = parsed.tests.filter((t) => t.outcome !== "skipped").length;
  return {
    executed,
    collectionError: parsed.collectionError,
    selection,
    tests: parsed.tests,
    cases: selection.target
      ? [
          {
            name: selection.target.nodeid,
            outcome: selection.target.outcome,
            revertProofAssertion: selection.target.revertProofAssertion,
            revertProofRed: selection.target.revertProofRed,
          },
        ]
      : [],
  };
}

async function runVitest(mainRoot, wtRoot, meta, slug, phase, timeoutMs, artifactsDir) {
  const { bin, cwd, config } = resolveVitestProject(wtRoot, meta);
  const jsonOut = path.join(artifactsDir, `${slug}-${phase}-vitest.json`);
  const testPattern = vitestTestNamePattern(meta.testName);
  const testFileAbs = path.join(wtRoot, meta.testFile);
  const testFileArg = path.relative(cwd, testFileAbs).replace(/\\/g, "/");
  const baseConfigAbs =
    config && path.isAbsolute(config)
      ? config
      : config
        ? path.join(cwd, config)
        : path.join(revertProofScriptsDir(wtRoot), "vitest.config.mjs");
  const overlayAbs = path.join(
    revertProofScriptsDir(wtRoot),
    "revert-proof-vitest-overlay.mjs",
  );
  const overlayRel = path.relative(cwd, overlayAbs).split(path.sep).join("/");
  const args = [
    "run",
    "--config",
    overlayRel,
    "-t",
    testPattern,
    "--reporter=json",
    `--outputFile.json=${jsonOut}`,
    "--",
    testFileArg,
  ];
  const result = await runProcess(bin, args, {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      REVERT_PROOF_ROOT: wtRoot,
      REVERT_PROOF_VITEST_BASE_CONFIG: baseConfigAbs,
      REVERT_PROOF_PYTHON: venvPython(mainRoot),
    },
    timeoutMs,
  });
  let report = null;
  if (fs.existsSync(jsonOut)) {
    report = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
  }
  const parsed = report
    ? parseVitestJsonReport(report)
    : { tests: [], suiteError: "no JSON report" };
  const counts = summarizeVitestCounts(parsed, meta.testName);
  return {
    command: formatCommandForReport(wtRoot, bin, args),
    ...result,
    counts,
    reportPath: jsonOut,
  };
}

function pytestSupportsNoCov(python) {
  const help = spawnSync(python, ["-m", "pytest", "--help"], {
    encoding: "utf8",
  });
  return help.status === 0 && help.stdout.includes("--no-cov");
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
  const jsonOut = path.join(artifactsDir, `${slug}-${phase}-pytest.json`);
  const python = venvPython(mainRoot);
  const nodeId = pytestNodeId(meta.testFile, meta.testName);
  const args = buildPytestArgv(nodeId, REVERT_PROOF_PYTEST_PLUGIN_MODULE, {
    includeNoCov: pytestSupportsNoCov(python),
  });
  if (!pytestArgvUsesNodeIdNotK(args)) {
    throw new Error(`row ${slug}: pytest argv must select by node id, never -k`);
  }
  const scriptsDir = revertProofScriptsDir(wtRoot);
  const baseEnv = pythonEnvForWorktree(wtRoot);
  const pythonPath = [scriptsDir, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter);
  const result = await runProcess(python, args, {
    cwd: wtRoot,
    env: {
      ...baseEnv,
      FORCE_COLOR: "0",
      PYTHONPATH: pythonPath,
      REVERT_PROOF_PYTEST_JSON: jsonOut,
    },
    timeoutMs,
  });
  const exitCode = result.exitCode ?? 1;
  let pluginParsed = { tests: [], collectionError: exitCode !== 0 };
  if (fs.existsSync(jsonOut)) {
    pluginParsed = parsePytestPluginJson(fs.readFileSync(jsonOut, "utf8"), exitCode);
  } else if (exitCode !== 0) {
    pluginParsed = { tests: [], collectionError: true };
  }
  const counts = summarizePytestCounts(pluginParsed, nodeId);
  return {
    command: formatCommandForReport(wtRoot, python, args),
    ...result,
    counts,
    reportPath: jsonOut,
  };
}

function formatCommandForReport(wtRoot, executable, args) {
  let binLabel = executable;
  try {
    const wtReal = path.resolve(wtRoot);
    const exeReal = path.resolve(executable);
    if (exeReal.startsWith(`${wtReal}${path.sep}`)) {
      binLabel = path.relative(wtReal, exeReal).split(path.sep).join("/");
    } else {
      binLabel = path.basename(executable);
    }
  } catch {
    binLabel = path.basename(executable);
  }
  const parts = [binLabel, ...args].map((p) => {
    const s = String(p);
    const sanitized = sanitizeReportText(s);
    return /\s/.test(sanitized) ? JSON.stringify(sanitized) : sanitized;
  });
  return parts.join(" ");
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
    return runVitest(mainRoot, wtRoot, meta, slug, phase, timeoutMs, artifactsDir);
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

function applyPatch(wtRoot, patchPath, patchText) {
  const applyInput = patchText ?? fs.readFileSync(patchPath, "utf8");
  try {
    gitApplyPatchStrict(wtRoot, applyInput);
  } catch (err) {
    removePatchArtifactFiles(wtRoot);
    throw err;
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

function assertExactlyOneTest(slug, phase, run, meta) {
  if (run.timedOut) {
    throw new Error(`row ${slug}: ${phase} timed out`);
  }
  const sel = run.counts.selection;
  if (!sel?.ok) {
    const reason = sel?.reason ?? "unknown";
    throw new Error(
      `row ${slug}: ${phase} test selection failed (${reason}; never a pass)`,
    );
  }
  if (metaRunnerCount(run) === 0) {
    throw new Error(
      `row ${slug}: ${phase} ran 0 tests (selection/filter error; never a pass)`,
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

async function runRow(mainRoot, wtRoot, row, artifactsDir) {
  const { slug, patchPath, patchText, meta } = row;
  validateRowMeta(meta, slug);
  validateTestFileRel(meta.testFile, wtRoot);
  validatePatchStructure(patchText, slug);
  validatePatchTouchesOnlyProduction(patchText, slug);
  validatePatchProductionReachable(patchText, slug, wtRoot);

  const timeoutSec = parseTimeoutSec(meta.timeoutSec, slug);
  const timeoutMs = timeoutSec * 1000;
  const testLabel = `${meta.testFile} :: ${meta.testName}`;

  resetWorktree(wtRoot);

  if (meta.runner === "pytest") {
    const mod = meta.pythonModule ?? "service";
    validatePythonModule(mod);
    ensurePythonIsolation(mainRoot, wtRoot, mod);
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
  try {
    assertExactlyOneTest(slug, "baseline", baseline, meta);
  } catch (err) {
    const snippet = trimFailureOutput(baseline.output || "");
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      snippet ? `${base}\n--- baseline output ---\n${snippet}` : base,
    );
  }
  if (meta.runner === "vitest") {
    if (baseline.counts.failed > 0 || baseline.counts.passed !== 1) {
      const snippet = trimFailureOutput(baseline.output || "");
      throw new Error(
        `row ${slug}: baseline test must PASS${snippet ? `\n--- baseline output ---\n${snippet}` : ""}`,
      );
    }
  } else if (baseline.counts.cases?.[0]?.outcome !== "passed") {
    const snippet = trimFailureOutput(baseline.output || "");
    throw new Error(
      `row ${slug}: baseline test must PASS${snippet ? `\n--- baseline output ---\n${snippet}` : ""}`,
    );
  }

  try {
    applyPatch(wtRoot, patchPath, patchText);
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
      if (allowTypeErrorEnabled(meta)) {
        tscNote = `allowTypeError: ${meta.allowTypeErrorReason ?? "yes"}`;
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
  assertExactlyOneTest(slug, "patched", patched, meta);

  if (meta.runner === "vitest") {
    const kind = classifyPatchedVitest({
      counts: patched.counts,
    });
    rejectPatchedVitestGreen(kind, slug);
    if (kind === "build break" || kind === "not single assertion failure") {
      const target = patched.counts.selection?.target;
      const failedWithoutMeta =
        target?.status === "failed" && target.revertProofAssertion !== true;
      if (failedWithoutMeta) {
        assertVitestNodeAssertFailClosed(slug, target);
        const hint = /^AssertionError\b/.test(target.failureMessage ?? "")
          ? "for a real expect() failure, suspect a mismatched chai copy — AssertionError must come from import { chai } from \"vitest\", not a separate chai package"
          : "non-assertion error";
        throw new Error(
          `row ${slug}: patched test failed but task.meta.revertProofAssertion is not true (proves nothing; ${hint})`,
        );
      }
      throw new Error(
        `row ${slug}: patch breaks build or fails without assertion (proves nothing)`,
      );
    }
  } else {
    const kind = classifyPatchedPytest({ counts: patched.counts });
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
  assertRedValue(slug, meta.red, patched.counts.selection.target.revertProofRed);

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
      `| ${escapeCell(e.slug)} | | | | **ERROR: ${escapeCell(sanitizeReportText(e.message))}** |`,
    );
  }
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.slug}`);
    lines.push("");
    lines.push("```");
    lines.push(sanitizeReportText(r.failureOutput || "(no output captured)"));
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
  validatePrNumber(prNumber);
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
  activeArtifactsDir = artifactsDir;

  const results = [];
  const errors = [];

  globalCleanup = () => {
    if (activeTestChild?.pid) {
      killProcessGroup(activeTestChild);
      activeTestChild = null;
    }
    removeWorktree(mainRoot, wtPath);
    gitAt(mainRoot, ["worktree", "prune"]);
    if (activeArtifactsDir && fs.existsSync(activeArtifactsDir)) {
      fs.rmSync(activeArtifactsDir, { recursive: true, force: true });
      activeArtifactsDir = null;
    }
  };

  try {
    addDetachedWorktree(mainRoot, wtPath, head);
    ensureJsDepsInWorktree(mainRoot, wtPath, rows);

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

export { runRow };
