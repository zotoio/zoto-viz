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

/** Vitest `-t` is a RegExp; anchor the full `describe > … > test` name. */
export function vitestTestNamePattern(fullTestName) {
  const normalized = fullTestName.replace(/\s*>\s*/g, " > ").trim();
  return `^${escapeVitestTestNamePattern(normalized)}$`;
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

export function buildPytestArgv(nodeId, xmlOut, { includeNoCov = true } = {}) {
  const args = [
    "-m",
    "pytest",
    "-p",
    "no:cacheprovider",
    nodeId,
    `--junitxml=${xmlOut}`,
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

/** @returns {string | null} */
export function vitestJunitFailureType(xmlText) {
  if (!xmlText?.trim()) return null;
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  let failedType = null;
  let failedCount = 0;
  while ((m = caseRe.exec(xmlText))) {
    const body = m[3] ?? "";
    if (!/<failure\b/.test(body)) continue;
    failedCount += 1;
    const tag = body.match(/<failure\b([^>]*)>/);
    const typeM = tag?.[1]?.match(/\btype="([^"]*)"/);
    failedType = typeM ? typeM[1] : null;
  }
  if (failedCount !== 1) return null;
  return failedType;
}

export function isVitestAssertionFailure(failedAssertions, junitXml) {
  const junitType = vitestJunitFailureType(junitXml ?? "");
  if (junitType !== null) {
    return junitType === "AssertionError";
  }
  for (const fa of failedAssertions ?? []) {
    const msg = (fa.messages ?? []).join("\n");
    if (/AssertionError|\bexpect\s*\(/.test(msg)) {
      return true;
    }
  }
  return false;
}

export function classifyPatchedVitest(run) {
  if (run.counts.suiteError) return "build break";
  const { executed, passed, failed } = run.counts;
  if (executed === 1 && passed === 1 && failed === 0) return "green";
  if (executed !== 1 || failed !== 1) return "not single assertion failure";
  if (!isVitestAssertionFailure(run.counts.failedAssertions, run.junitXml)) {
    return "build break";
  }
  return "assertion";
}

export function pytestFailureMessage(body) {
  if (!body) return "";
  const innerM = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/);
  const text = innerM ? innerM[1] : body;
  const lines = text.replace(/&#10;/g, "\n").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

export function isPytestAssertionBody(body) {
  const typeM = body.match(/<failure\b[^>]*\btype="([^"]*)"/);
  if (typeM?.[1] === "AssertionError") return true;
  if (typeM?.[1] && typeM[1] !== "AssertionError") return false;

  const msgM = body.match(/<failure\b[^>]*\bmessage="([^"]*)"/);
  if (msgM?.[1]?.startsWith("AssertionError")) return true;
  if (msgM?.[1] && /^[A-Za-z]+(?:Error|Exception):/.test(msgM[1])) {
    return false;
  }

  if (/\bAssertionError\b/.test(body)) return true;

  const first = pytestFailureMessage(body);
  if (first.startsWith("AssertionError")) return true;
  if (first.startsWith("assert ")) return true;
  return false;
}

export function classifyPatchedPytest(run) {
  if (run.counts.collectionError) return "build break";
  const cases = run.counts.cases ?? [];
  if (cases.length !== 1) return "not single test";
  const c = cases[0];
  if (c.outcome === "error") return "build break";
  if (c.outcome === "passed") return "green";
  if (c.outcome === "failed") {
    return isPytestAssertionBody(c.body) ? "assertion" : "build break";
  }
  return "unknown";
}

/** @returns {{ executed: number, cases: {name:string,outcome:string,body:string}[], collectionError: boolean }} */
export function parsePytestJunit(xmlText, pytestExitCode) {
  const cases = [];
  if (!xmlText?.trim()) {
    return {
      executed: 0,
      cases,
      collectionError: pytestExitCode !== 0,
    };
  }
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xmlText))) {
    const attrs = m[1];
    const body = m[3] ?? "";
    const nameM = attrs.match(/\bname="([^"]*)"/);
    const name = nameM ? nameM[1] : "";
    if (/<skipped\b/.test(body)) continue;
    let outcome = "passed";
    if (/<failure\b/.test(body)) outcome = "failed";
    else if (/<error\b/.test(body)) outcome = "error";
    cases.push({ name, outcome, body });
  }
  const collectionError = pytestExitCode !== 0 && cases.length === 0;
  return { executed: cases.length, cases, collectionError };
}

export function sanitizeReportText(text) {
  return String(text)
    .replace(/\/tmp\/[^\s]+/g, "<tmp>")
    .replace(/revert-proof-wt-[^\s]+/g, "<worktree>")
    .replace(/revert-proof-artifacts-[^\s]+/g, "<artifacts>");
}
