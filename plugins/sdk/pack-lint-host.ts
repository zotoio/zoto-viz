/**
 * Reverse boundary: host (`web/src/**`) must not import pack source (`plugins/src/**`).
 *
 * **Allowed exception (not scanned as a file import):** compiled pack bundles are loaded
 * only through `PluginSandbox.loadModule` → `fetch(pluginModuleUrl(id, hash))` serving
 * `/api/plugins/<id>/module.js` (see `web/src/plugins/host.ts`). That HTTP path is not an
 * ES module specifier. Dynamic `import()` / static imports of that URL are allowed here
 * so tests can mirror the loader; they do not resolve into `plugins/src/**`.
 */

import fs from "node:fs";
import path from "node:path";
import type { PackLintViolation } from "./pack-lint-types";

const WEB_SRC = "web/src";
const PACK_SRC = "plugins/src";

export type TsPathConfig = {
  /** Absolute path to the tsconfig `baseUrl` directory (usually `web/`). */
  baseUrlAbs: string;
  /** TypeScript `paths` entries (keys may end with `/*`). */
  paths: Record<string, string[]>;
};

function stripImportSuffix(spec: string): string {
  const q = spec.indexOf("?");
  return q >= 0 ? spec.slice(0, q) : spec;
}

/** Load `web/tsconfig.json` path mappings for alias resolution. */
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
  if (/^https?:\/\//.test(bare)) return true;
  if (!/^\/api\/plugins\/[^/]+\/module\.js/.test(bare)) return false;
  if (bare.includes("..")) return false;
  return true;
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

  const pathMapped = applyTsPaths(bare, pathConfig, extraPaths);
  let resolvedAbs: string;
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

/** Map template-literal `${…}` segments to `*` so glob-style resolution can match pack paths. */
function normalizeTemplateSpec(spec: string): string {
  return spec.includes("${") ? spec.replace(/\$\{[^}]*\}/g, "*") : spec;
}

export function extractModuleSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*`([^`]+)`\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*`([^`]+)`\s*\)/g,
    /\bimport\.meta\.glob\s*\(\s*["']([^"']+)["']/g,
    /\bimport\.meta\.glob\s*\(\s*`([^`]+)`\s*\)/g,
    /\bimport\.meta\.glob\s*\(\s*\[([^\]]+)\]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (re.source.includes("\\[")) {
        const inner = m[1]!;
        for (const part of inner.match(/["'`]([^"'`]+)["'`]/g) ?? []) {
          specs.push(part.slice(1, -1));
        }
      } else {
        specs.push(m[1]!);
      }
    }
  }
  return specs;
}

export function hostImportsPackSrcViolations(
  hostRepoRel: string,
  text: string,
  repoRoot: string,
  pathConfig: TsPathConfig,
  extraPaths?: Record<string, string[]>,
): PackLintViolation[] {
  const rule = "host-imports-pack-src" as const;
  const specs = extractModuleSpecifiers(text);
  const hits: PackLintViolation[] = [];
  for (const spec of specs) {
    const bare = normalizeTemplateSpec(spec);
    const resolved = resolveToRepoRel(bare, hostRepoRel, repoRoot, pathConfig, extraPaths);
    if (resolvesIntoPackSrc(resolved)) {
      hits.push({ file: hostRepoRel, rule });
      break;
    }
    if (bare.includes("*") || bare.includes("?")) {
      const globBase = stripImportSuffix(bare).split("*")[0] ?? "";
      const globResolved = resolveToRepoRel(globBase || bare, hostRepoRel, repoRoot, pathConfig, extraPaths);
      if (resolvesIntoPackSrc(globResolved)) {
        hits.push({ file: hostRepoRel, rule });
        break;
      }
    }
  }
  return hits;
}

function listWebSrcFiles(webRoot: string, rel = ""): string[] {
  const dir = path.join(webRoot, rel);
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listWebSrcFiles(webRoot, sub));
    else if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) out.push(sub);
  }
  return out;
}

export function scanWebSrc(
  repoRoot: string,
  extraPaths?: Record<string, string[]>,
): PackLintViolation[] {
  const webRoot = path.join(repoRoot, WEB_SRC);
  const pathConfig = loadWebTsPathConfig(repoRoot);
  const violations: PackLintViolation[] = [];
  for (const rel of listWebSrcFiles(webRoot)) {
    const repoRel = `${WEB_SRC}/${rel}`.replace(/\\/g, "/");
    const text = fs.readFileSync(path.join(webRoot, rel), "utf8");
    violations.push(...hostImportsPackSrcViolations(repoRel, text, repoRoot, pathConfig, extraPaths));
  }
  violations.sort((a, b) => (a.file === b.file ? a.rule.localeCompare(b.rule) : a.file.localeCompare(b.file)));
  return violations;
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
