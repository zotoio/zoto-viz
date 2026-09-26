/** Shared pure helpers for revert-proof (imported by runner + tests). */
import fs from "node:fs";
import path from "node:path";

export const MAX_TIMER_MS = 2_147_483_647;

export const TEST_PATH_RE =
  /(?:^|\/)(?:tests\/|__tests__\/|fixtures\/|revert-proof\/|src\/test\/|conftest\.py$|(?:vite|vitest)\.config\.|pytest\.ini$|scripts\/vitest\.config\.mjs$)|(?:^|\/)(?:.*\.test\.[cm]?[jt]sx?|.*\.spec\.[cm]?[jt]sx?|.*_test\.py|test_[^/]*\.py)$/;

const PYTHON_MODULE_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function validatePrNumber(pr) {
  if (!/^\d+$/.test(String(pr))) {
    throw new Error(`invalid PR number: ${pr}`);
  }
}

export function validatePythonModule(name) {
  if (!PYTHON_MODULE_RE.test(name)) {
    throw new Error(`invalid pythonModule: ${name}`);
  }
}

export function validateTestFileRel(testFile, wtRoot) {
  const rel = testFile.replace(/\\/g, "/");
  if (rel.startsWith("-") || path.isAbsolute(rel) || rel.includes("..")) {
    throw new Error(`invalid testFile path: ${testFile}`);
  }
  const abs = path.resolve(wtRoot, rel);
  const root = path.resolve(wtRoot);
  if (!abs.startsWith(`${root}${path.sep}`) && abs !== root) {
    throw new Error(`testFile escapes repo: ${testFile}`);
  }
}

export function parseTimeoutSec(raw, slug) {
  if (raw === undefined || raw === null) {
    return 120;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`row ${slug}: timeoutSec must be a positive finite number`);
  }
  const ms = raw * 1000;
  if (ms > MAX_TIMER_MS) {
    throw new Error(
      `row ${slug}: timeoutSec exceeds Node timer maximum (${MAX_TIMER_MS / 1000}s)`,
    );
  }
  return raw;
}

export function allowTypeErrorEnabled(meta) {
  return meta.allowTypeError === true;
}

export function validatePatchStructure(patchText, slug) {
  if (!patchText.includes("--- ") && !patchText.includes("+++ ")) {
    throw new Error(`row ${slug}: patch has no ---/+++ file headers`);
  }
  if (/^GIT binary patch/m.test(patchText) || /^Binary files /m.test(patchText)) {
    throw new Error(`row ${slug}: binary patches are not allowed`);
  }
  const hasDevNull = /^--- \/dev\/null/m.test(patchText) || /^\+\+\+ \/dev\/null/m.test(patchText);
  const onlyDeletes = [...patchText.matchAll(/^--- (.*)$/gm)].every((m) =>
    patchText.includes(`+++ /dev/null`) || m[1].includes("dev/null"),
  );
  if (hasDevNull && onlyDeletes) {
    throw new Error(`row ${slug}: delete-only patches are not allowed`);
  }
  if (/^rename from /m.test(patchText) || /^rename to /m.test(patchText)) {
    throw new Error(`row ${slug}: rename patches are not allowed`);
  }
  /** @type {{ old?: string, new?: string }[]} */
  const pairs = [];
  for (const line of patchText.split("\n")) {
    if (line.startsWith("--- ")) {
      pairs.push({ old: line.slice(4).trim().replace(/^\w+\//, "") });
    } else if (line.startsWith("+++ ")) {
      const last = pairs[pairs.length - 1];
      if (last && last.new === undefined) {
        last.new = line.slice(4).trim().replace(/^\w+\//, "");
      }
    }
  }
  for (const { old: oldPath, new: newPath } of pairs) {
    if (!oldPath || !newPath) continue;
    const o = oldPath.split("\t")[0];
    const n = newPath.split("\t")[0];
    if (o !== "/dev/null" && n !== "/dev/null" && o !== n) {
      throw new Error(`row ${slug}: rename patches are not allowed`);
    }
  }
  const touched = [...pairs]
    .flatMap((p) => [p.old, p.new])
    .filter(Boolean)
    .map((p) => String(p).split("\t")[0].replace(/^\w+\//, ""))
    .filter((p) => p && p !== "/dev/null");
  for (const p of touched) {
    if (!TEST_PATH_RE.test(p)) continue;
    const hasContentChange = patchText.split("\n").some(
      (line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"),
    );
    if (!hasContentChange && (/^old mode /m.test(patchText) || /^new mode /m.test(patchText))) {
      throw new Error(`row ${slug}: mode-only patches on test files are not allowed`);
    }
  }
}

export function escapeVitestTestNamePattern(testName) {
  return testName.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** Vitest `-t` is a RegExp; anchor the sidecar full name verbatim (` > ` segments included). */
export function vitestTestNamePattern(fullTestName) {
  return `^${escapeVitestTestNamePattern(fullTestName)}$`;
}

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

export function buildPytestArgv(nodeId, pluginModule, { includeNoCov = true } = {}) {
  const args = [
    "-m",
    "pytest",
    "-p",
    "no:cacheprovider",
    "-p",
    pluginModule,
    nodeId,
  ];
  if (includeNoCov) {
    args.splice(2, 0, "--no-cov");
  }
  return args;
}

export function pytestArgvUsesNodeIdNotK(argv) {
  const args = argv ?? [];
  if (args.includes("-k")) return false;
  const pytestIdx = args.indexOf("pytest");
  if (pytestIdx < 0) return false;
  const after = args.slice(pytestIdx + 1);
  return after.some((a) => a.includes("::") && !a.startsWith("-"));
}

/**
 * @param {string} wtRoot
 * @param {{ testFile: string, project?: string }} meta
 */
export function resolveVitestProject(wtRoot, meta) {
  const rel = meta.testFile.replace(/\\/g, "/");
  let project = meta.project;
  if (!project) {
    if (rel.startsWith("scripts/")) project = "scripts";
    else if (rel.startsWith("web/revert-proof/")) project = "scripts";
    else if (rel.startsWith("web/")) project = "web";
    else project = "root";
  }
  const rootBin = path.join(wtRoot, "node_modules", ".bin", "vitest");
  const webBin = path.join(wtRoot, "web", "node_modules", ".bin", "vitest");
  if (project === "web") {
    const cwd = path.join(wtRoot, "web");
    const configCandidates = [
      "vite.config.ts",
      "vitest.config.ts",
      "vitest.config.mjs",
      "vitest.config.js",
    ];
    let config = null;
    for (const name of configCandidates) {
      const p = path.join(cwd, name);
      if (fs.existsSync(p)) {
        config = p;
        break;
      }
    }
    if (!config) {
      throw new Error(`no vitest config found under ${cwd}`);
    }
    const bin = fs.existsSync(webBin) ? webBin : rootBin;
    if (!fs.existsSync(bin)) {
      throw new Error(`vitest not found for web project under ${wtRoot}`);
    }
    return { cwd, config, bin };
  }
  if (project === "scripts") {
    const config = path.join(wtRoot, "scripts", "vitest.config.mjs");
    if (!fs.existsSync(config)) {
      throw new Error(`missing scripts/vitest.config.mjs in ${wtRoot}`);
    }
    const bin = fs.existsSync(rootBin) ? rootBin : webBin;
    if (!fs.existsSync(bin)) {
      throw new Error(`vitest not found under ${wtRoot}`);
    }
    return { cwd: wtRoot, config, bin };
  }
  const bin = fs.existsSync(rootBin) ? rootBin : webBin;
  const cwd = fs.existsSync(rootBin) ? wtRoot : path.join(wtRoot, "web");
  const config = path.join(wtRoot, "scripts", "vitest.config.mjs");
  if (!fs.existsSync(bin)) {
    throw new Error(`vitest not found under ${wtRoot}`);
  }
  return { cwd, config: fs.existsSync(config) ? config : null, bin };
}

export function patchTouchesTestFiles(patchText) {
  const paths = new Set();
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const p = line.slice(4).replace(/^\w+\//, "").trim();
      if (p === "/dev/null") continue;
      paths.add(p);
    }
  }
  return [...paths].some((p) => TEST_PATH_RE.test(p));
}

const VITEST_SKIP_STATUSES = new Set(["skipped", "pending", "todo"]);

export function vitestAssertionFullName(assertion) {
  if (Array.isArray(assertion.ancestorTitles) && typeof assertion.title === "string") {
    return [...assertion.ancestorTitles, assertion.title].join(" > ");
  }
  return assertion.fullName || assertion.title;
}

/** @returns {{ tests: { fullName: string, status: string, revertProofAssertion: boolean }[], suiteError: string | null }} */
export function parseVitestJsonReport(report) {
  /** @type {{ fullName: string, status: string, revertProofAssertion: boolean }[]} */
  const tests = [];
  if (!report?.testResults?.length) {
    return {
      tests,
      suiteError: report ? "no tests executed" : "no JSON report",
    };
  }
  for (const file of report.testResults ?? []) {
    if (file.status === "failed" && (!file.assertionResults || file.assertionResults.length === 0)) {
      return { tests, suiteError: file.message || "suite failed" };
    }
    for (const t of file.assertionResults ?? []) {
      tests.push({
        fullName: vitestAssertionFullName(t),
        status: t.status,
        revertProofAssertion: t.meta?.revertProofAssertion === true,
      });
    }
  }
  return { tests, suiteError: null };
}

/**
 * @param {{ fullName: string, status: string, revertProofAssertion: boolean }[]} tests
 * @param {string} testName
 */
export function assessVitestSelection(tests, testName) {
  const target = tests.find((t) => t.fullName === testName);
  if (!target) {
    return { ok: false, reason: "target not found", target: null };
  }
  if (VITEST_SKIP_STATUSES.has(target.status)) {
    return { ok: false, reason: "target skipped", target };
  }
  const others = tests.filter((t) => t.fullName !== testName);
  if (!others.every((t) => VITEST_SKIP_STATUSES.has(t.status))) {
    return { ok: false, reason: "other tests not skipped", target };
  }
  return { ok: true, target, reason: null };
}

export function classifyPatchedVitest(run) {
  if (run.counts.suiteError) return "build break";
  const sel = run.counts.selection;
  if (!sel?.ok || !sel.target) return "not single assertion failure";
  if (sel.target.status === "passed") return "green";
  if (sel.target.status !== "failed") return "build break";
  return sel.target.revertProofAssertion ? "assertion" : "build break";
}

/** @returns {{ tests: { nodeid: string, outcome: string, revertProofAssertion: boolean }[], collectionError: boolean }} */
export function parsePytestPluginJson(text, pytestExitCode) {
  if (!text?.trim()) {
    return { tests: [], collectionError: pytestExitCode !== 0 };
  }
  try {
    const data = JSON.parse(text);
    const tests = Array.isArray(data.tests) ? data.tests : [];
    return { tests, collectionError: false };
  } catch {
    return { tests: [], collectionError: true };
  }
}

/**
 * @param {{ nodeid: string, outcome: string, revertProofAssertion: boolean }[]} tests
 * @param {string} nodeId
 */
export function assessPytestSelection(tests, nodeId) {
  const target = tests.find((t) => t.nodeid === nodeId);
  if (!target) {
    return { ok: false, reason: "target not found", target: null };
  }
  if (target.outcome === "skipped") {
    return { ok: false, reason: "target skipped", target };
  }
  const others = tests.filter((t) => t.nodeid !== nodeId);
  if (!others.every((t) => t.outcome === "skipped")) {
    return { ok: false, reason: "other tests not skipped", target };
  }
  return { ok: true, target, reason: null };
}

export function classifyPatchedPytest(run) {
  if (run.counts.collectionError) return "build break";
  const sel = run.counts.selection;
  if (!sel?.ok || !sel.target) return "not single test";
  if (sel.target.outcome === "error") return "build break";
  if (sel.target.outcome === "passed") return "green";
  if (sel.target.outcome === "failed") {
    return sel.target.revertProofAssertion ? "assertion" : "build break";
  }
  return "unknown";
}

export function sanitizeReportText(text) {
  return String(text)
    .replace(/\/tmp\/[^\s]+/g, "<tmp>")
    .replace(/revert-proof-wt-[^\s]+/g, "<worktree>")
    .replace(/revert-proof-artifacts-[^\s]+/g, "<artifacts>");
}
