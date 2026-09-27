/** Shared helpers and guards for revert-proof (imported by the runner script and tests). */
import { spawnSync } from "node:child_process";
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

export function validateTestFileRel(testFile, wtRoot, meta) {
  const rel = testFile.replace(/\\/g, "/");
  if (rel.startsWith("-") || path.isAbsolute(rel) || rel.includes("..")) {
    throw new Error(`invalid testFile path: ${testFile}`);
  }
  let abs = path.resolve(wtRoot, rel);
  if (meta?.project === "web" && !rel.startsWith("web/")) {
    abs = path.resolve(wtRoot, "web", rel);
  }
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

export function validateRowMeta(meta, slug) {
  for (const key of ["runner", "testFile", "testName", "description"]) {
    if (!meta[key] || typeof meta[key] !== "string") {
      throw new Error(`row ${slug}: sidecar JSON missing string field "${key}"`);
    }
  }
  if (meta.runner !== "vitest" && meta.runner !== "pytest") {
    throw new Error(`row ${slug}: runner must be vitest or pytest`);
  }
  validateRedSidecar(meta, slug);
}

/** Vitest: `{ actual, expected }`. Pytest: `{ assert: "assert …" }`. */
export function validateRedSidecar(meta, slug) {
  const red = meta.red;
  if (!red || typeof red !== "object" || Array.isArray(red)) {
    throw new Error(`row ${slug}: sidecar JSON missing object field "red"`);
  }
  if (meta.runner === "vitest") {
    if (
      !Object.prototype.hasOwnProperty.call(red, "actual") ||
      !Object.prototype.hasOwnProperty.call(red, "expected")
    ) {
      throw new Error(
        `row ${slug}: vitest red must be { actual, expected } (structured assertion values)`,
      );
    }
    return;
  }
  if (typeof red.assert !== "string" || !red.assert.trim().startsWith("assert ")) {
    throw new Error(
      `row ${slug}: pytest red must be { assert: "assert …" } (rewritten assert source)`,
    );
  }
}

export function redValuesEqual(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/** Compare structured red from the first branded assertion (vitest) or assert line (pytest). */
export function assertRedValue(slug, expected, actual) {
  if (!redValuesEqual(expected, actual)) {
    throw new Error(
      `row ${slug}: red value mismatch (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)})`,
    );
  }
}

export function firstLine(text) {
  return String(text ?? "").split("\n")[0];
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
    return { cwd, config, bin, project };
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

const VITEST_SKIP_STATUSES = new Set(["skipped", "pending", "todo"]);

export function vitestAssertionFullName(assertion) {
  if (Array.isArray(assertion.ancestorTitles) && typeof assertion.title === "string") {
    return [...assertion.ancestorTitles, assertion.title].join(" > ");
  }
  return assertion.fullName || assertion.title;
}

/** @returns {{ tests: { fullName: string, status: string, revertProofAssertion: boolean, revertProofNodeAssert: boolean, revertProofRed: { actual: unknown, expected: unknown } | null, failureMessage: string | null }[], suiteError: string | null }} */
export function parseVitestJsonReport(report) {
  /** @type {{ fullName: string, status: string, revertProofAssertion: boolean, revertProofNodeAssert: boolean, revertProofRed: { actual: unknown, expected: unknown } | null, failureMessage: string | null }[]} */
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
      const revertProofRed = t.meta?.revertProofRed ?? null;
      tests.push({
        fullName: vitestAssertionFullName(t),
        status: t.status,
        revertProofAssertion: t.meta?.revertProofAssertion === true,
        revertProofNodeAssert: t.meta?.revertProofNodeAssert === true,
        revertProofRed:
          revertProofRed &&
          typeof revertProofRed === "object" &&
          "actual" in revertProofRed &&
          "expected" in revertProofRed
            ? { actual: revertProofRed.actual, expected: revertProofRed.expected }
            : null,
        failureMessage: t.failureMessages?.length ? firstLine(t.failureMessages[0]) : null,
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
  const matches = tests.filter((t) => t.fullName === testName);
  const executedMatches = matches.filter(
    (t) => !VITEST_SKIP_STATUSES.has(t.status),
  );
  if (matches.length === 0) {
    return { ok: false, reason: "target not found", target: null };
  }
  if (executedMatches.length > 1) {
    return { ok: false, reason: "multiple tests matched filter", target: null };
  }
  if (executedMatches.length === 0) {
    const skippedTarget = matches[0];
    if (VITEST_SKIP_STATUSES.has(skippedTarget.status)) {
      return { ok: false, reason: "target skipped", target: skippedTarget };
    }
    return { ok: false, reason: "target not found", target: null };
  }
  const target = executedMatches[0];
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

/**
 * @typedef {{ nodeid: string, outcome: string, revertProofAssertion: boolean, revertProofRed: { assert: string } | null }} PytestPluginTest
 */

/** @returns {PytestPluginTest} */
function normalizePytestPluginTest(t) {
  const red = t?.revertProofRed;
  return {
    nodeid: t?.nodeid,
    outcome: t?.outcome,
    revertProofAssertion: t?.revertProofAssertion === true,
    revertProofRed:
      red && typeof red === "object" && typeof red.assert === "string"
        ? { assert: red.assert }
        : null,
  };
}

/** @returns {{ tests: PytestPluginTest[], collectionError: boolean }} */
export function parsePytestPluginJson(text, pytestExitCode) {
  if (!text?.trim()) {
    return { tests: [], collectionError: pytestExitCode !== 0 };
  }
  try {
    const data = JSON.parse(text);
    const tests = Array.isArray(data.tests) ? data.tests.map(normalizePytestPluginTest) : [];
    return { tests, collectionError: false };
  } catch {
    return { tests: [], collectionError: true };
  }
}

/**
 * @param {{ nodeid: string, outcome: string, revertProofAssertion?: boolean, revertProofRed?: unknown }[]} tests
 * @param {string} nodeId
 * @returns {{ ok: boolean, reason: string | null, target: PytestPluginTest | null }}
 */
export function assessPytestSelection(tests, nodeId) {
  const found = tests.find((t) => t.nodeid === nodeId);
  const target = found ? normalizePytestPluginTest(found) : null;
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

export function validatePatchTouchesOnlyProduction(patchText, slug) {
  if (patchTouchesTestFiles(patchText)) {
    throw new Error(
      `row ${slug}: patch touches test files (only production reverts allowed)`,
    );
  }
}

const PRODUCTION_CONFIG_NAME = "revert-proof-production.json";

const JS_EXT = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];
const PY_EXT = [".py"];

function normRel(p) {
  return p.replace(/\\/g, "/");
}

function isExcludedProductionTestPath(rel) {
  const p = normRel(rel);
  return (
    TEST_PATH_RE.test(p) ||
    /(?:^|\/)(?:tests\/|__tests__\/|fixtures\/|revert-proof\/)/.test(p) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
    /\/test_[^/]*\.py$/.test(p)
  );
}

function loadProductionConfig(wtRoot) {
  const configPath = path.join(wtRoot, "scripts", PRODUCTION_CONFIG_NAME);
  let raw = {
    scanRoots: ["web/src", "plugins", "service", "packages"],
    entryPoints: ["web/src/app/main.ts", "web/index.html", "service/monitor.py"],
    packEntryGlob: "plugins/src/*/frontend/index.ts",
    reachExempt: ["scripts/revert-proof.mjs"],
  };
  if (fs.existsSync(configPath)) {
    raw = { ...raw, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  }
  const entryPoints = new Set(
    (raw.entryPoints ?? []).map((e) => normRel(e)),
  );
  const packGlob = raw.packEntryGlob ?? "";
  if (packGlob.includes("*")) {
    const [prefix, suffix] = packGlob.split("*");
    const midDir = path.join(wtRoot, prefix);
    const tail = suffix.replace(/^\//, "");
    if (fs.existsSync(midDir)) {
      for (const ent of fs.readdirSync(midDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const candidate = normRel(path.join(prefix, ent.name, tail));
        if (fs.existsSync(path.join(wtRoot, candidate))) {
          entryPoints.add(candidate);
        }
      }
    }
  }
  return {
    scanRoots: (raw.scanRoots ?? []).map((r) => normRel(r)),
    entryPoints,
    reachExempt: new Set((raw.reachExempt ?? []).map((p) => normRel(p))),
  };
}

function walkProductionFiles(wtRoot, scanRoots) {
  const files = [];
  const skipDir = new Set([
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "__pycache__",
    ".venv",
  ]);
  function walk(absDir, relDir) {
    if (!fs.existsSync(absDir)) return;
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (skipDir.has(ent.name)) continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (isExcludedProductionTestPath(rel)) continue;
        walk(abs, rel);
        continue;
      }
      if (isExcludedProductionTestPath(rel)) continue;
      if (
        JS_EXT.some((e) => ent.name.endsWith(e)) ||
        PY_EXT.some((e) => ent.name.endsWith(e))
      ) {
        files.push(normRel(rel));
      }
    }
  }
  for (const root of scanRoots) {
    walk(path.join(wtRoot, root), root);
  }
  return files;
}

function readPackageNameMap(wtRoot) {
  const map = new Map();
  function addPkg(pkgDir, relDir) {
    const pkgPath = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgPath)) return;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (!pkg.name) return;
      let main = pkg.main ?? pkg.module;
      if (!main && pkg.exports) {
        const exp =
          typeof pkg.exports === "string"
            ? pkg.exports
            : pkg.exports["."];
        if (typeof exp === "string") main = exp;
        else if (exp?.import) main = exp.import;
        else if (exp?.default) main = exp.default;
      }
      if (!main) main = "index.js";
      const resolved = normRel(path.join(relDir, main.replace(/^\.\//, "")));
      map.set(pkg.name, resolved);
    } catch {
      /* ignore */
    }
  }
  addPkg(path.join(wtRoot, "web"), "web");
  const packagesDir = path.join(wtRoot, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const ent of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        addPkg(path.join(packagesDir, ent.name), `packages/${ent.name}`);
      }
    }
  }
  return map;
}

function resolveJsFile(wtRoot, fromRel, spec) {
  const fromDir = path.dirname(fromRel);
  let target;
  if (spec.startsWith(".")) {
    target = normRel(path.join(fromDir, spec));
  } else if (spec.startsWith("@/") || spec.startsWith("~/")) {
    return null;
  } else if (!spec.startsWith("@") && !spec.includes("/")) {
    return null;
  } else {
    const pkgMap = readPackageNameMap(wtRoot);
    const bare = spec.split("/")[0].startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : spec.split("/")[0];
    const mapped = pkgMap.get(bare);
    if (!mapped) return null;
    if (spec === bare) {
      target = mapped;
    } else {
      const sub = spec.slice(bare.length + 1);
      target = normRel(path.join(path.dirname(mapped), sub));
    }
  }
  return materializeModulePath(wtRoot, target);
}

function materializeModulePath(wtRoot, base) {
  const rel = normRel(base);
  const candidates = [rel];
  if (rel.endsWith(".js")) {
    candidates.push(rel.slice(0, -3));
  }
  for (const stem of candidates) {
    const abs = path.join(wtRoot, stem);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return stem;
    }
    for (const ext of JS_EXT) {
      if (fs.existsSync(`${abs}${ext}`)) {
        return `${stem}${ext}`;
      }
    }
    for (const ext of JS_EXT) {
      const idx = path.join(abs, `index${ext}`);
      if (fs.existsSync(idx)) {
        return normRel(path.join(stem, `index${ext}`));
      }
    }
  }
  return null;
}

const JS_IMPORT_RE =
  /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function jsImportsInFile(wtRoot, relFile) {
  const abs = path.join(wtRoot, relFile);
  if (!fs.existsSync(abs)) return [];
  const text = fs.readFileSync(abs, "utf8");
  const specs = new Set();
  let m;
  JS_IMPORT_RE.lastIndex = 0;
  while ((m = JS_IMPORT_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (spec) specs.add(spec);
  }
  const resolved = [];
  for (const spec of specs) {
    const r = resolveJsFile(wtRoot, relFile, spec);
    if (r) resolved.push(r);
  }
  return resolved;
}

function pyModuleToPath(wtRoot, moduleName, fromRel) {
  const parts = moduleName.split(".");
  if (moduleName.startsWith(".")) {
    const fromDir = path.dirname(fromRel);
    const level = moduleName.match(/^\.+/)?.[0].length ?? 0;
    const rest = moduleName.slice(level).replace(/\./g, "/");
    let dir = fromDir;
    for (let i = 1; i < level; i++) {
      dir = path.dirname(dir);
    }
    const base = rest ? path.join(dir, rest) : dir;
    return materializePyPath(wtRoot, normRel(base));
  }
  if (parts[0] === "service") {
    const base = normRel(path.join("service", parts.slice(1).join("/")));
    return materializePyPath(wtRoot, base);
  }
  const rootMod = normRel(parts.join("/"));
  return materializePyPath(wtRoot, rootMod);
}

function materializePyPath(wtRoot, base) {
  const rel = normRel(base);
  const abs = path.join(wtRoot, rel);
  if (fs.existsSync(`${abs}.py`)) return `${rel}.py`;
  if (fs.existsSync(path.join(abs, "__init__.py"))) {
    return normRel(path.join(rel, "__init__.py"));
  }
  return null;
}

const PY_FROM_IMPORT_RE =
  /^\s*from\s+(\.+[\w.]*|\w+(?:\.\w+)*)\s+import\s+([^#\n]+)/gm;
const PY_IMPORT_RE = /^\s*import\s+([\w.]+)/gm;

function pyRelativeImportTarget(wtRoot, fromRel, levelPrefix, rest, importName) {
  const fromDir = path.dirname(fromRel);
  let dir = fromDir;
  const level = levelPrefix.length;
  for (let i = 1; i < level; i++) {
    dir = path.dirname(dir);
  }
  if (rest) {
    return pyModuleToPath(wtRoot, `${levelPrefix}${rest}`, fromRel);
  }
  if (!importName || importName === "*") {
    return materializePyPath(wtRoot, normRel(dir));
  }
  const base = path.join(dir, importName.replace(/\./g, "/"));
  return materializePyPath(wtRoot, normRel(base));
}

function pyImportsInFile(wtRoot, relFile) {
  const abs = path.join(wtRoot, relFile);
  if (!fs.existsSync(abs)) return [];
  const text = fs.readFileSync(abs, "utf8");
  const resolved = [];
  let m;
  PY_FROM_IMPORT_RE.lastIndex = 0;
  while ((m = PY_FROM_IMPORT_RE.exec(text))) {
    const mod = m[1];
    const names = m[2]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    if (mod.startsWith(".")) {
      const levelPrefix = mod.match(/^\.+/)?.[0] ?? ".";
      const rest = mod.slice(levelPrefix.length).replace(/\./g, "/");
      if (rest) {
        const r = pyModuleToPath(wtRoot, mod, relFile);
        if (r) resolved.push(r);
      } else {
        for (const name of names) {
          const r = pyRelativeImportTarget(wtRoot, relFile, levelPrefix, "", name);
          if (r) resolved.push(r);
        }
      }
      continue;
    }
    const r = pyModuleToPath(wtRoot, mod, relFile);
    if (r) resolved.push(r);
  }
  PY_IMPORT_RE.lastIndex = 0;
  while ((m = PY_IMPORT_RE.exec(text))) {
    const mod = m[1];
    if (!mod) continue;
    const r = pyModuleToPath(wtRoot, mod, relFile);
    if (r) resolved.push(r);
  }
  return resolved;
}

function buildProductionImporterGraph(wtRoot) {
  const config = loadProductionConfig(wtRoot);
  const productionFiles = walkProductionFiles(wtRoot, config.scanRoots);
  const productionSet = new Set(productionFiles);
  /** @type {Map<string, Set<string>>} */
  const importers = new Map();

  for (const file of productionFiles) {
    const deps = file.endsWith(".py")
      ? pyImportsInFile(wtRoot, file)
      : jsImportsInFile(wtRoot, file);
    for (const dep of deps) {
      if (!productionSet.has(dep)) continue;
      if (!importers.has(dep)) importers.set(dep, new Set());
      importers.get(dep).add(file);
    }
  }
  return { importers, entryPoints: config.entryPoints };
}

/** @type {null | { root: string, graph: ReturnType<typeof buildProductionImporterGraph> }} */
let productionGraphCache = null;

function getProductionGraph(wtRoot) {
  const root = fs.realpathSync(wtRoot);
  if (!productionGraphCache || productionGraphCache.root !== root) {
    productionGraphCache = {
      root,
      graph: buildProductionImporterGraph(wtRoot),
    };
  }
  return productionGraphCache.graph;
}

function isRevertTargetReachableFromProduction(wtRoot, relFile) {
  const file = normRel(relFile);
  const { importers, entryPoints } = getProductionGraph(wtRoot);
  if (entryPoints.has(file)) {
    return true;
  }
  const seen = new Set();
  let queue = [...(importers.get(file) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (entryPoints.has(cur)) {
      return true;
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const up of importers.get(cur) ?? []) {
      if (!seen.has(up)) {
        queue.push(up);
      }
    }
  }
  return false;
}

export function validatePatchProductionReachable(patchText, slug, wtRoot) {
  const { reachExempt } = loadProductionConfig(wtRoot);
  for (const touched of pathsTouchedByPatch(patchText)) {
    const file = normRel(touched);
    if (isExcludedProductionTestPath(file)) {
      continue;
    }
    if (reachExempt.has(file)) {
      continue;
    }
    if (!isRevertTargetReachableFromProduction(wtRoot, file)) {
      throw new Error(
        `row ${slug}: revert target unreachable from production: ${file}`,
      );
    }
  }
}

const SKIP_WALK = new Set([".git", "node_modules", ".venv", "revert-proofs"]);

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
  if (real === wtReal || real.startsWith(`${wtReal}${path.sep}`)) {
    return;
  }
  throw new Error(
    `workspace link ${linkPath} resolves outside worktree: ${real}`,
  );
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

export function pythonEnvForWorktree(wtRoot) {
  return {
    ...process.env,
    PYTHONPATH: wtRoot,
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

export function assertEditablePythonResolvesInWorktree(
  wtRoot,
  python,
  moduleName = "service",
) {
  validatePythonModule(moduleName);
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

export function rejectPatchedVitestGreen(kind, slug) {
  if (kind === "green") {
    throw new Error(
      `row ${slug}: test stayed GREEN after revert patch (expected failure)`,
    );
  }
}

/**
 * Fail closed when a patched vitest target failed via node:assert (not branded expect).
 * @param {string} slug
 * @param {{ status?: string, revertProofAssertion?: boolean, revertProofNodeAssert?: boolean } | null | undefined} target
 */
export function assertVitestNodeAssertFailClosed(slug, target) {
  if (
    target?.status === "failed" &&
    target.revertProofAssertion !== true &&
    target.revertProofNodeAssert === true
  ) {
    throw new Error(`row ${slug}: red is not from expect; node:assert is not supported`);
  }
}
