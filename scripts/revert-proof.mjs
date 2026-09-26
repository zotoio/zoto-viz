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
  TEST_PATH_RE,
  allowTypeErrorEnabled,
  buildPytestArgv,
  classifyPatchedPytest,
  classifyPatchedVitest,
  escapeVitestTestNamePattern,
  parsePytestJunit,
  parseTimeoutSec,
  patchTouchesTestFiles,
  pytestNodeId,
  resolveVitestProject,
  sanitizeReportText,
  validatePatchStructure,
  validatePrNumber,
  validatePythonModule,
  validateTestFileRel,
  vitestTestNamePattern,
  isVitestJunitSkipped,
} from "./revert-proof-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_SEC = 120;

export {
  escapeVitestTestNamePattern,
  patchTouchesTestFiles,
  pytestNodeId,
  vitestTestNamePattern,
};

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

export function validatePatchTouchesOnlyProduction(patchText, slug) {
  if (patchTouchesTestFiles(patchText)) {
    throw new Error(
      `row ${slug}: patch touches test files (only production reverts allowed)`,
    );
  }
}

const PRODUCTION_CONFIG_NAME = "revert-proof-production.json";

const REACH_EXEMPT = new Set(["scripts/revert-proof.mjs"]);

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
  };
  if (fs.existsSync(configPath)) {
    raw = { ...raw, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  }
  for (const p of raw.reachExempt ?? []) {
    REACH_EXEMPT.add(normRel(p));
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

export function isRevertTargetReachableFromProduction(wtRoot, relFile) {
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
  loadProductionConfig(wtRoot);
  for (const touched of pathsTouchedByPatch(patchText)) {
    const file = normRel(touched);
    if (isExcludedProductionTestPath(file)) {
      continue;
    }
    if (REACH_EXEMPT.has(file)) {
      continue;
    }
    if (!isRevertTargetReachableFromProduction(wtRoot, file)) {
      throw new Error(
        `row ${slug}: revert target unreachable from production: ${file}`,
      );
    }
  }
}

function tscBin(wtRoot) {
  const bin = path.join(wtRoot, "web", "node_modules", ".bin", "tsc");
  if (!fs.existsSync(bin)) {
    return null;
  }
  return bin;
}

const SKIP_WALK = new Set([".git", "node_modules", ".venv", "revert-proofs"]);

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

export function pythonEnvForWorktree(wtRoot) {
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

function countVitestExecuted(report) {
  let executed = 0;
  let passed = 0;
  let failed = 0;
  const failedAssertions = [];
  /** @type {{ fullName: string, status: string }[]} */
  const ranTests = [];
  if (!report?.testResults?.length) {
    return {
      executed: 0,
      passed: 0,
      failed: 0,
      suiteError: report ? "no tests executed" : "no JSON report",
      failedAssertions: [],
      ranTests,
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
        ranTests,
      };
    }
    for (const t of file.assertionResults ?? []) {
      if (t.status === "skipped" || t.status === "pending" || t.status === "todo") {
        continue;
      }
      executed += 1;
      // Vitest 5's JSON reporter flattens nested names with spaces in
      // `fullName`. Rebuild the sidecar's `describe > … > test` form from
      // the structured fields so literal ` > ` text in a title stays intact.
      const fullName =
        Array.isArray(t.ancestorTitles) && typeof t.title === "string"
          ? [...t.ancestorTitles, t.title].join(" > ")
          : t.fullName || t.title;
      ranTests.push({ fullName, status: t.status });
      if (t.status === "passed") passed += 1;
      if (t.status === "failed") {
        failed += 1;
        failedAssertions.push({
          name: fullName,
          messages: t.failureMessages ?? [],
        });
      }
    }
  }
  return { executed, passed, failed, suiteError: null, failedAssertions, ranTests };
}

function decodeXmlAttribute(value) {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi,
    (entity, decimal, hex) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      }[entity.toLowerCase()];
    },
  );
}

export function vitestJunitExecutedTestNames(xmlText) {
  const names = [];
  const testcaseRe =
    /<testcase\b((?:"[^"]*"|'[^']*'|[^'">/])*)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let testcase;
  while ((testcase = testcaseRe.exec(xmlText ?? ""))) {
    const attrsText = testcase[1];
    const body = testcase[2] ?? "";
    if (isVitestJunitSkipped(attrsText, body)) continue;
    const attrs = {};
    const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attr;
    while ((attr = attrRe.exec(attrsText))) {
      attrs[attr[1]] = decodeXmlAttribute(attr[2] ?? attr[3] ?? "");
    }
    if (attrs.name === undefined) continue;
    const candidates = [attrs.name];
    if (attrs.classname) {
      candidates.push(`${attrs.classname} > ${attrs.name}`);
    }
    names.push(candidates);
  }
  return names;
}

function assertVitestTestSelection(slug, phase, meta, counts, junitXml) {
  const ran = counts.ranTests ?? [];
  if (ran.length !== 1) {
    throw new Error(
      `row ${slug}: ${phase} must run exactly 1 test (got ${ran.length})`,
    );
  }
  const ranName = ran[0].fullName;
  if (ranName !== meta.testName) {
    throw new Error(
      `row ${slug}: ${phase} ran "${ranName}" but sidecar expects "${meta.testName}"`,
    );
  }
  const junitExecuted = vitestJunitExecutedTestNames(junitXml);
  const junitMatches = junitExecuted.filter((cands) => cands.includes(meta.testName));
  if (junitMatches.length !== 1) {
    throw new Error(
      `row ${slug}: ${phase} JUnit must have exactly 1 executed testcase matching sidecar (got ${junitMatches.length} matches among ${junitExecuted.length} executed)`,
    );
  }
}

async function runVitest(wtRoot, meta, slug, phase, timeoutMs, artifactsDir) {
  const { bin, cwd, config } = resolveVitestProject(wtRoot, meta);
  const jsonOut = path.join(artifactsDir, `${slug}-${phase}-vitest.json`);
  const junitOut = path.join(artifactsDir, `${slug}-${phase}-vitest.xml`);
  const testPattern = vitestTestNamePattern(meta.testName);
  const testFileAbs = path.join(wtRoot, meta.testFile);
  const testFileArg = path.relative(cwd, testFileAbs).replace(/\\/g, "/");
  const configArg =
    config && path.isAbsolute(config)
      ? path.relative(cwd, config).split(path.sep).join("/") || config
      : config;
  const args = [
    "run",
    "--config",
    configArg,
    "-t",
    testPattern,
    "--reporter=json",
    `--outputFile.json=${jsonOut}`,
    "--reporter=junit",
    `--outputFile.junit=${junitOut}`,
    "--",
    testFileArg,
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
  const junitXml = fs.existsSync(junitOut) ? fs.readFileSync(junitOut, "utf8") : "";
  const counts = report
    ? countVitestExecuted(report)
    : {
        executed: 0,
        passed: 0,
        failed: 0,
        suiteError: "no JSON report",
        failedAssertions: [],
        ranTests: [],
      };
  return {
    command: formatCommandForReport(wtRoot, bin, args),
    ...result,
    counts,
    junitXml,
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
  const xmlOut = path.join(artifactsDir, `${slug}-${phase}-pytest.xml`);
  const python = venvPython(mainRoot);
  const nodeId = pytestNodeId(meta.testFile, meta.testName);
  const args = buildPytestArgv(nodeId, xmlOut, {
    includeNoCov: pytestSupportsNoCov(python),
  });
  const result = await runProcess(python, args, {
    cwd: wtRoot,
    env: { ...pythonEnvForWorktree(wtRoot), FORCE_COLOR: "0" },
    timeoutMs,
  });
  const exitCode = result.exitCode ?? 1;
  let parsed = { executed: 0, cases: [], collectionError: exitCode !== 0 };
  if (fs.existsSync(xmlOut)) {
    parsed = parsePytestJunit(fs.readFileSync(xmlOut, "utf8"), exitCode);
  } else if (exitCode !== 0) {
    parsed = { executed: 0, cases: [], collectionError: true };
  }
  return {
    command: formatCommandForReport(wtRoot, python, args),
    ...result,
    counts: parsed,
    reportPath: xmlOut,
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

const GIT_APPLY_OPTS = ["--whitespace=error"];

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
  const tmpPatch = path.join(wtRoot, ".revert-proof-apply.patch");
  fs.writeFileSync(tmpPatch, applyInput, "utf8");
  const check = gitAt(wtRoot, ["apply", "--check", ...GIT_APPLY_OPTS, tmpPatch]);
  if (check.status !== 0) {
    fs.unlinkSync(tmpPatch);
    throw new Error(
      `git apply --check failed: ${check.stderr || check.stdout}`,
    );
  }
  const apply = gitAt(wtRoot, ["apply", ...GIT_APPLY_OPTS, tmpPatch]);
  fs.unlinkSync(tmpPatch);
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

function assertExactlyOneTest(slug, phase, run, meta) {
  if (run.timedOut) {
    throw new Error(`row ${slug}: ${phase} timed out`);
  }
  const executed = metaRunnerCount(run);
  if (executed === 0) {
    throw new Error(
      `row ${slug}: ${phase} ran 0 tests (selection/filter error; never a pass)`,
    );
  }
  if (run.junitXml !== undefined && meta?.runner === "vitest") {
    assertVitestTestSelection(slug, phase, meta, run.counts, run.junitXml);
  } else if (executed !== 1) {
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

async function runRow(mainRoot, wtRoot, row, artifactsDir) {
  const { slug, patchPath, patchText, meta } = row;
  validateMeta(meta, slug);
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
      junitXml: patched.junitXml,
    });
    rejectPatchedVitestGreen(kind, slug);
    if (kind === "build break" || kind === "not single assertion failure") {
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
  productionGraphCache = null;

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
