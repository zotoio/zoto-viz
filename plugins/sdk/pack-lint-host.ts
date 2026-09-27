/**
 * Reverse boundary: host (`web/src/**`) must not reach pack source (`plugins/src/**`).
 *
 * **Allowed pack load:** only a literal `/api/plugins/<id>/module.js` specifier (optional query, no `..`).
 * Every `http://` / `https://` import is a violation. `/@fs/…` specifiers that resolve into
 * `plugins/src/**` are violations. Symlinks under `web/src` (files or directories) are resolved
 * with realpath before the pack check.
 */

import fs from "node:fs";
import path from "node:path";
import { isHostPackSrcImportAllowlisted, packIdFromPluginsSrcTarget } from "./host-pack-src-import-allowlist";
import { extractModuleSpecifiers } from "./pack-lint-import";
import type { PackLintViolation } from "./pack-lint-types";
import { violationKey } from "./pack-lint-types";

export {
  HOST_PACK_SRC_IMPORT_ALLOWLIST,
  HOST_PACK_SRC_IMPORT_ALLOWLIST_COUNT,
  isHostPackSrcImportAllowlisted,
  packIdFromPluginsSrcTarget,
} from "./host-pack-src-import-allowlist";

export { extractModuleSpecifiers } from "./pack-lint-import";

const WEB_SRC = "web/src";
const SERVICE_ROOT = "service";
const PACK_SRC = "plugins/src";

const WEB_SRC_FILE_RE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i;

export type TsPathConfig = {
  baseUrlAbs: string;
  paths: Record<string, string[]>;
};

function stripImportSuffix(spec: string): string {
  const q = spec.indexOf("?");
  return q >= 0 ? spec.slice(0, q) : spec;
}

export function loadWebTsPathConfig(repoRoot: string): TsPathConfig {
  const tsconfigPath = path.join(repoRoot, "web/tsconfig.json");
  const raw = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  const baseRel = raw.compilerOptions?.baseUrl ?? ".";
  const baseUrlAbs = path.resolve(path.join(repoRoot, "web"), baseRel);
  const paths = raw.compilerOptions?.paths ?? {};
  return { baseUrlAbs, paths };
}

function matchPathPattern(pattern: string, spec: string): string | null {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    if (!spec.startsWith(prefix)) return null;
    return spec.slice(prefix.length);
  }
  return spec === pattern ? "" : null;
}

function applyTsPaths(
  spec: string,
  pathConfig: TsPathConfig,
  extraPaths?: Record<string, string[]>,
): string | null {
  const merged = { ...pathConfig.paths, ...extraPaths };
  for (const [pattern, targets] of Object.entries(merged)) {
    const tail = matchPathPattern(pattern, spec);
    if (tail === null) continue;
    for (const target of targets) {
      const repl = target.endsWith("/*") ? target.slice(0, -2) + tail : target;
      return repl;
    }
  }
  return null;
}

function isAllowedPackLoadSpecifier(spec: string): boolean {
  const bare = stripImportSuffix(spec);
  if (!/^\/api\/plugins\/[^/]+\/module\.js/.test(bare)) return false;
  if (bare.includes("..")) return false;
  return true;
}

function repoRelFromAbs(absPath: string, repoRoot: string): string | null {
  const real = fs.realpathSync.native(absPath);
  const repoRel = path.relative(repoRoot, real).replace(/\\/g, "/");
  if (repoRel.startsWith("../")) return null;
  return repoRel;
}

/** Resolve import path to an existing file or directory under the repo (realpath). */
export function canonicalPackLintTarget(resolvedRepoRel: string, repoRoot: string): string {
  let norm = resolvedRepoRel.replace(/\\/g, "/");
  if (norm.includes("*")) {
    norm = norm.split("*")[0]!.replace(/\/$/, "");
  }
  const abs = path.join(repoRoot, norm);
  const bare = stripImportSuffix(norm);
  const tries = [
    abs,
    `${abs}.ts`,
    `${abs}.tsx`,
    `${abs}.mts`,
    `${abs}.cts`,
    `${abs}.js`,
    `${abs}.mjs`,
    `${abs}.cjs`,
    path.join(abs, "index.ts"),
    path.join(bare, "index.ts") !== path.join(abs, "index.ts") ? path.join(repoRoot, bare, "index.ts") : "",
  ].filter(Boolean) as string[];

  for (const candidate of tries) {
    try {
      if (fs.existsSync(candidate)) {
        const rel = repoRelFromAbs(candidate, repoRoot);
        if (rel) return rel;
      }
    } catch {
      /* try next */
    }
  }

  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      const rel = repoRelFromAbs(abs, repoRoot);
      if (rel) return rel;
    }
  } catch {
    /* fall through */
  }

  return norm;
}

function resolveToRepoRel(
  spec: string,
  hostRepoRel: string,
  repoRoot: string,
  pathConfig: TsPathConfig,
  extraPaths?: Record<string, string[]>,
): string | null {
  const bare = stripImportSuffix(spec);
  if (!bare || isAllowedPackLoadSpecifier(bare)) return null;

  let resolvedAbs: string | null = null;

  if (bare.startsWith("/@fs/")) {
    let absFs = path.normalize(decodeURIComponent(bare.slice("/@fs/".length)));
    if (!fs.existsSync(absFs)) {
      const idx = absFs.replace(/\\/g, "/").indexOf(`${PACK_SRC}/`);
      if (idx >= 0) absFs = path.join(repoRoot, absFs.slice(idx));
    }
    resolvedAbs = absFs;
  } else if (/^https?:\/\//i.test(bare)) {
    try {
      const pathname = new URL(bare).pathname.replace(/\\/g, "/");
      const idx = pathname.indexOf(`/${PACK_SRC}/`);
      if (idx >= 0) {
        const tail = pathname.slice(idx + 1);
        resolvedAbs = path.normalize(path.join(repoRoot, tail));
      } else {
        return null;
      }
    } catch {
      return null;
    }
  } else {
    const pathMapped = applyTsPaths(bare, pathConfig, extraPaths);
    if (pathMapped) {
      resolvedAbs = path.isAbsolute(pathMapped)
        ? pathMapped
        : path.resolve(pathConfig.baseUrlAbs, pathMapped);
    } else if (bare.startsWith(".")) {
      resolvedAbs = path.normalize(path.join(repoRoot, path.dirname(hostRepoRel), bare));
    } else if (bare.startsWith("/")) {
      resolvedAbs = path.normalize(path.join(repoRoot, bare));
    } else if (bare.includes(`${PACK_SRC}/`) || bare.startsWith(`${PACK_SRC}`)) {
      resolvedAbs = path.normalize(path.join(repoRoot, bare.replace(/^\.\/+/, "")));
    } else {
      return null;
    }
  }

  if (!resolvedAbs) return null;
  const repoRel = path.relative(repoRoot, resolvedAbs).replace(/\\/g, "/");
  if (repoRel.startsWith("../")) return null;
  return repoRel;
}

function resolvesIntoPackSrc(repoRel: string | null): boolean {
  if (!repoRel) return false;
  if (repoRel.startsWith(`${PACK_SRC}/`)) return true;
  if (repoRel.includes("/.runtime/") && repoRel.includes("/plugins/")) {
    return false;
  }
  return false;
}

function normalizeTemplateSpec(spec: string): string {
  return spec.includes("${") ? spec.replace(/\$\{[^}]*\}/g, "*") : spec;
}

function pushHostHit(
  hits: PackLintViolation[],
  seen: Set<string>,
  hostRepoRel: string,
  spec: string,
  target: string,
): void {
  const v = { file: hostRepoRel, rule: "host-imports-pack-src" as const, target, detail: spec };
  const k = violationKey(v);
  if (seen.has(k)) return;
  seen.add(k);
  hits.push(v);
}

function remoteImportTarget(bareUrl: string): string {
  return `remote:${bareUrl}`;
}

export function hostImportsPackSrcViolations(
  hostRepoRel: string,
  text: string,
  repoRoot: string,
  pathConfig: TsPathConfig,
  extraPaths?: Record<string, string[]>,
): PackLintViolation[] {
  const specs = extractModuleSpecifiers(text);
  const hits: PackLintViolation[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const bare = stripImportSuffix(normalizeTemplateSpec(spec));
    if (/^https?:\/\//i.test(bare)) {
      const resolved = resolveToRepoRel(bare, hostRepoRel, repoRoot, pathConfig, extraPaths);
      if (resolvesIntoPackSrc(resolved)) {
        pushHostHit(hits, seen, hostRepoRel, spec, canonicalPackLintTarget(resolved!, repoRoot));
      } else {
        pushHostHit(hits, seen, hostRepoRel, spec, remoteImportTarget(bare));
      }
      continue;
    }
    const resolved = resolveToRepoRel(bare, hostRepoRel, repoRoot, pathConfig, extraPaths);
    if (resolvesIntoPackSrc(resolved)) {
      pushHostHit(hits, seen, hostRepoRel, spec, canonicalPackLintTarget(resolved!, repoRoot));
      continue;
    }
    if (bare.includes("*") || bare.includes("?")) {
      const globBase = stripImportSuffix(bare).split("*")[0] ?? "";
      const globResolved = resolveToRepoRel(globBase || bare, hostRepoRel, repoRoot, pathConfig, extraPaths);
      if (resolvesIntoPackSrc(globResolved)) {
        pushHostHit(hits, seen, hostRepoRel, spec, canonicalPackLintTarget(globResolved!, repoRoot));
      }
    }
  }
  hits.sort((a, b) => a.target.localeCompare(b.target));
  return hits;
}

function listWebSrcFiles(webRoot: string, rel = ""): string[] {
  const dir = path.join(webRoot, rel);
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listWebSrcFiles(webRoot, sub));
    else if (WEB_SRC_FILE_RE.test(ent.name)) out.push(sub);
  }
  return out;
}

function scanWebSrcSymlinks(repoRoot: string): PackLintViolation[] {
  const webRoot = path.join(repoRoot, WEB_SRC);
  const violations: PackLintViolation[] = [];
  const seen = new Set<string>();

  const flagSymlink = (sub: string, linkTarget: string, real: string) => {
    const packRel = path.relative(repoRoot, real).replace(/\\/g, "/");
    if (!packRel.startsWith(`${PACK_SRC}/`)) return;
    const hostFile = `${WEB_SRC}/${sub}`.replace(/\\/g, "/");
    const target = canonicalPackLintTarget(packRel, repoRoot);
    const v = {
      file: hostFile,
      rule: "host-imports-pack-src" as const,
      target,
      detail: `symlink → ${linkTarget}`,
    };
    const k = violationKey(v);
    if (seen.has(k)) return;
    seen.add(k);
    violations.push(v);
  };

  const walk = (rel: string) => {
    const dir = path.join(webRoot, rel);
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(webRoot, sub);
      if (ent.isSymbolicLink()) {
        let linkTarget = "";
        let real = "";
        try {
          linkTarget = fs.readlinkSync(full);
          real = fs.realpathSync.native(full);
        } catch {
          continue;
        }
        flagSymlink(sub, linkTarget, real);
        try {
          if (fs.statSync(real).isDirectory()) walk(sub);
        } catch {
          /* ignore */
        }
        continue;
      }
      if (ent.isDirectory()) {
        walk(sub);
        continue;
      }
      if (!WEB_SRC_FILE_RE.test(ent.name)) continue;
    }
  };

  walk("");
  return violations;
}

export function isHostCodeRepoPath(repoRel: string): boolean {
  const norm = repoRel.replace(/\\/g, "/");
  if (norm.startsWith(`${WEB_SRC}/`)) {
    if (norm.includes("/fixtures/")) return false;
    if (/\.test\.(tsx?|mts|cts|jsx?)$/i.test(norm)) return false;
    return true;
  }
  if (norm.startsWith(`${SERVICE_ROOT}/`)) {
    if (norm.includes("/fixtures/")) return false;
    if (norm.includes("/tests/")) return false;
    const base = path.basename(norm);
    if (base.startsWith("test_")) return false;
    if (base.endsWith("_test.py")) return false;
    return true;
  }
  return false;
}

export function disallowedHostPackSrcImports(violations: PackLintViolation[]): PackLintViolation[] {
  return violations.filter((v) => {
    if (v.rule !== "host-imports-pack-src") return false;
    if (!isHostCodeRepoPath(v.file)) return false;
    const packId = packIdFromPluginsSrcTarget(v.target);
    if (packId && isHostPackSrcImportAllowlisted(packId)) return false;
    return true;
  });
}

const PY_PACK_SRC_IMPORT_RE =
  /(?:^|\s)(?:from|import)\s+[^\n#]*\bplugins\/src\/([a-z0-9][a-z0-9-]*)\//;

function pythonPackSrcImportViolations(hostRepoRel: string, text: string): PackLintViolation[] {
  const hits: PackLintViolation[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const m = PY_PACK_SRC_IMPORT_RE.exec(line);
    if (!m) continue;
    const packId = m[1]!;
    const target = `${PACK_SRC}/${packId}/`;
    const v = {
      file: hostRepoRel,
      rule: "host-imports-pack-src" as const,
      target,
      detail: stripped,
      line: i + 1,
    };
    const k = violationKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    hits.push(v);
  }
  return hits;
}

function listServicePyFiles(serviceRoot: string, rel = ""): string[] {
  const dir = path.join(serviceRoot, rel);
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "__pycache__" || ent.name === "node_modules") continue;
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listServicePyFiles(serviceRoot, sub));
    else if (ent.name.endsWith(".py")) out.push(sub);
  }
  return out;
}

export function scanService(repoRoot: string): PackLintViolation[] {
  const serviceRoot = path.join(repoRoot, SERVICE_ROOT);
  if (!fs.existsSync(serviceRoot)) return [];
  const violations: PackLintViolation[] = [];
  for (const rel of listServicePyFiles(serviceRoot)) {
    const repoRel = `${SERVICE_ROOT}/${rel}`.replace(/\\/g, "/");
    if (!isHostCodeRepoPath(repoRel)) continue;
    const text = fs.readFileSync(path.join(serviceRoot, rel), "utf8");
    violations.push(...pythonPackSrcImportViolations(repoRel, text));
  }
  violations.sort((a, b) => a.file.localeCompare(b.file));
  return violations;
}

export function scanWebSrc(
  repoRoot: string,
  extraPaths?: Record<string, string[]>,
): PackLintViolation[] {
  const webRoot = path.join(repoRoot, WEB_SRC);
  const pathConfig = loadWebTsPathConfig(repoRoot);
  const violations: PackLintViolation[] = [...scanWebSrcSymlinks(repoRoot)];
  for (const rel of listWebSrcFiles(webRoot)) {
    const repoRel = `${WEB_SRC}/${rel}`.replace(/\\/g, "/");
    const text = fs.readFileSync(path.join(webRoot, rel), "utf8");
    violations.push(...hostImportsPackSrcViolations(repoRel, text, repoRoot, pathConfig, extraPaths));
  }
  const seen = new Set<string>();
  const deduped = violations.filter((v) => {
    const k = violationKey(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.target.localeCompare(b.target);
  });
  return deduped;
}

export function scanHostLintFixture(
  hostRepoRel: string,
  text: string,
  repoRoot: string,
  extraPaths?: Record<string, string[]>,
): PackLintViolation[] {
  const pathConfig = loadWebTsPathConfig(repoRoot);
  return hostImportsPackSrcViolations(hostRepoRel, text, repoRoot, pathConfig, extraPaths);
}
