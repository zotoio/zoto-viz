/**
 * Static guardrails for shipped plugin packs under plugins/src/**.
 */

import fs from "node:fs";
import path from "node:path";
import type { PackLintBaseline, PackLintRule, PackLintViolation } from "./pack-lint-types";
import { violationKey } from "./pack-lint-types";
import { INLINE_ZOTO_DECLARE_HINT } from "./viz-zoto";

export type { PackLintBaseline, PackLintRule, PackLintViolation } from "./pack-lint-types";
export { formatViolationMessage, violationKey } from "./pack-lint-types";

const PACKS_ROOT = "plugins/src";
const SDK_ROOT = "plugins/sdk";

const SANDBOX_RULES: { target: string; re: RegExp }[] = [
  { target: "parent.", re: /\bparent\s*\./ },
  { target: "typeof parent", re: /\btypeof\s+parent\b/ },
  { target: "window.parent", re: /\bwindow\.parent\b/ },
  { target: "window.top", re: /\bwindow\.top\b/ },
  { target: "top.", re: /\btop\s*\./ },
  { target: "document.cookie", re: /\bdocument\.cookie\b/ },
  { target: "localStorage", re: /\blocalStorage\b/ },
  { target: "sessionStorage", re: /\bsessionStorage\b/ },
  { target: "indexedDB", re: /\bindexedDB\b/ },
];

function listPackIds(packsRoot: string): string[] {
  return fs
    .readdirSync(packsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function listPackTsFiles(packsRoot: string, packId: string): string[] {
  const dir = path.join(packsRoot, packId);
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(sub);
      else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(sub);
    }
  };
  walk("");
  return out;
}

function codeWithoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function sandboxViolations(repoRel: string, text: string): PackLintViolation[] {
  const code = codeWithoutComments(text);
  for (const { target, re } of SANDBOX_RULES) {
    if (re.test(code)) {
      return [{ file: repoRel, rule: "sandbox-escape", target }];
    }
  }
  return [];
}

function resolveImport(
  specifier: string,
  packId: string,
  repoRelFile: string,
  repoRoot: string,
): string | null {
  if (specifier.includes("web/src/")) return specifier;
  const bare = specifier.match(/(?:^|\/)plugins\/src\/([^/]+)/);
  if (bare && bare[1] !== packId) return bare[1];
  if (specifier.includes("/plugins/sdk/") || specifier.includes("/sdk/")) return null;
  if (!specifier.startsWith(".")) return null;
  const abs = path.normalize(path.join(repoRoot, path.dirname(repoRelFile), specifier));
  const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
  if (rel.startsWith("plugins/sdk/")) return null;
  if (!rel.startsWith("plugins/src/")) return null;
  const m = rel.match(/^plugins\/src\/([^/]+)/);
  if (m && m[1] !== packId) return m[1];
  if (rel.includes("web/src/")) return rel;
  return null;
}

function importViolations(
  repoRel: string,
  text: string,
  packId: string,
  repoRoot: string,
): PackLintViolation[] {
  const hits: PackLintViolation[] = [];
  const re = /import\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1]!;
    if (spec.includes("web/src/")) {
      hits.push({ file: repoRel, rule: "host-import", target: spec });
      continue;
    }
    const cross = resolveImport(spec, packId, repoRel, repoRoot);
    if (cross) hits.push({ file: repoRel, rule: "cross-pack-import", target: spec });
  }
  return hits;
}

function inlineZotoDeclare(repoRel: string, text: string): PackLintViolation[] {
  if (/\bdeclare\s+const\s+zoto\b/.test(text)) {
    return [{
      file: repoRel,
      rule: "inline-zoto-declare",
      target: "declare-const-zoto",
      detail: INLINE_ZOTO_DECLARE_HINT,
    }];
  }
  return [];
}

/** Match `zoto.onFrame = <handler>` and scan handler body for getConfig calls. */
function getConfigInOnFrame(repoRel: string, text: string): PackLintViolation[] {
  const code = codeWithoutComments(text);
  const assignRe = /zoto\.onFrame\s*=\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(code)) !== null) {
    const start = m.index + m[0].length;
    const body = extractBracedBlock(code, start - 1);
    if (body && /\bgetConfig\s*\(/.test(body)) {
      return [{ file: repoRel, rule: "get-config-in-on-frame", target: "getConfig()" }];
    }
  }
  const fnRe = /zoto\.onFrame\s*=\s*function\s*\([^)]*\)\s*\{/g;
  while ((m = fnRe.exec(code)) !== null) {
    const start = m.index + m[0].length;
    const body = extractBracedBlock(code, start - 1);
    if (body && /\bgetConfig\s*\(/.test(body)) {
      return [{ file: repoRel, rule: "get-config-in-on-frame", target: "getConfig()" }];
    }
  }
  return [];
}

function extractBracedBlock(code: string, openBraceIndex: number): string | null {
  if (code[openBraceIndex] !== "{") return null;
  let depth = 0;
  for (let i = openBraceIndex; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return code.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

function lintPackSource(
  repoRel: string,
  text: string,
  packId: string,
  repoRoot: string,
): PackLintViolation[] {
  const merged = [
    ...sandboxViolations(repoRel, text),
    ...importViolations(repoRel, text, packId, repoRoot),
    ...inlineZotoDeclare(repoRel, text),
    ...getConfigInOnFrame(repoRel, text),
  ];
  const seen = new Set<string>();
  return merged.filter((v) => {
    const k = violationKey(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

import { scanWebSrc } from "./pack-lint-host";

export function scanAllGuardrails(repoRoot: string): PackLintViolation[] {
  const merged = [...scanPluginsSrc(repoRoot), ...scanWebSrc(repoRoot)];
  merged.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.target.localeCompare(b.target);
  });
  return merged;
}

export { scanHostLintFixture, scanWebSrc } from "./pack-lint-host";

export function scanPluginsSrc(repoRoot: string): PackLintViolation[] {
  const packsRoot = path.join(repoRoot, PACKS_ROOT);
  const violations: PackLintViolation[] = [];
  for (const packId of listPackIds(packsRoot)) {
    for (const rel of listPackTsFiles(packsRoot, packId)) {
      const repoRel = path.join(PACKS_ROOT, packId, rel).replace(/\\/g, "/");
      const text = fs.readFileSync(path.join(repoRoot, repoRel), "utf8");
      violations.push(...lintPackSource(repoRel, text, packId, repoRoot));
    }
  }
  violations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.target.localeCompare(b.target);
  });
  return violations;
}

export function scanPackLintFixture(
  repoRel: string,
  text: string,
  packId: string,
  repoRoot: string,
): PackLintViolation[] {
  return lintPackSource(repoRel, text, packId, repoRoot);
}

export function loadBaseline(repoRoot: string): PackLintBaseline {
  const p = path.join(repoRoot, SDK_ROOT, "pack-lint-baseline.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as PackLintBaseline;
}

export function assertBaselineGuard(
  current: PackLintViolation[],
  baseline: PackLintBaseline,
): { newViolations: PackLintViolation[]; staleViolations: PackLintViolation[]; ok: boolean } {
  const baseSet = new Set(baseline.violations.map(violationKey));
  const curSet = new Set(current.map(violationKey));
  const newViolations = current.filter((v) => !baseSet.has(violationKey(v)));
  const staleViolations = baseline.violations.filter((v) => !curSet.has(violationKey(v)));
  return {
    newViolations,
    staleViolations,
    ok: newViolations.length === 0 && staleViolations.length === 0,
  };
}

/** Count baseline violations per pack id for reporting (plugins/src only). */
export function baselineCountsByPack(baseline: PackLintBaseline): Record<string, Partial<Record<PackLintRule, number>>> {
  const out: Record<string, Partial<Record<PackLintRule, number>>> = {};
  for (const v of baseline.violations) {
    const m = v.file.match(/^plugins\/src\/([^/]+)\//);
    if (!m) continue;
    const pack = m[1]!;
    out[pack] ??= {};
    out[pack][v.rule] = (out[pack][v.rule] ?? 0) + 1;
  }
  return out;
}

/** Total baseline hits per rule (pack + host). */
export function baselineCountsByRule(baseline: PackLintBaseline): Partial<Record<PackLintRule, number>> {
  const out: Partial<Record<PackLintRule, number>> = {};
  for (const v of baseline.violations) {
    out[v.rule] = (out[v.rule] ?? 0) + 1;
  }
  return out;
}

/** Host files baselined for `host-imports-pack-src`. */
export function baselineHostPackImports(baseline: PackLintBaseline): string[] {
  return baseline.violations
    .filter((v) => v.rule === "host-imports-pack-src")
    .map((v) => v.file)
    .sort();
}
