/**
 * Static guardrails for shipped plugin packs under plugins/src/**.
 */

import fs from "node:fs";
import path from "node:path";
import {
  classifyPackSpecifier,
  extractPackImports,
  lineColAt,
  maskComments,
  packSymlinkEscapes,
} from "./pack-lint-import";
import type { PackLintBaseline, PackLintRule, PackLintViolation } from "./pack-lint-types";
import { violationKey } from "./pack-lint-types";
import { legacyZotoViolationsOnDisallowedPacks } from "./legacy-zoto-pack-allowlist";
import { INLINE_ZOTO_DECLARE_HINT, PACK_ZOTO_BINDING_HINT } from "./viz-zoto";

export {
  LEGACY_DECLARE_ZOTO_PACK_IDS,
  LEGACY_ZOTO_ALLOWLIST_RULES,
  isLegacyDeclareZotoPackAllowed,
  legacyZotoViolationsOnDisallowedPacks,
  packIdFromPluginsSrcPath,
} from "./legacy-zoto-pack-allowlist";

export type { PackLintBaseline, PackLintRule, PackLintViolation } from "./pack-lint-types";
export { formatViolationMessage } from "./pack-lint-hints";
export { violationKey } from "./pack-lint-types";

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
    const fullDir = path.join(dir, rel);
    for (const ent of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, sub);
      if (ent.isSymbolicLink()) {
        if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(sub);
        continue;
      }
      if (ent.isDirectory()) walk(sub);
      else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(sub);
    }
  };
  walk("");
  return out;
}

function withLoc(repoRel: string, source: string, index: number, v: Omit<PackLintViolation, "line" | "column">): PackLintViolation {
  const { line, column } = lineColAt(source, index);
  return { ...v, file: repoRel, line, column };
}

const HOST_TRANSPORT_RULES: { target: string; re: RegExp }[] = [
  { target: "postMessage", re: /\bpostMessage\s*\(/ },
  { target: "host-message-import", re: /\bfrom\s+["'][^"']*web\/src\/plugins\/host/ },
  {
    target: "host-message-type",
    re: /\bfrom\s+["'][^"']*(?:HostMsg|ParentMsg|zoto-viz-host|zoto-viz-plugin)/,
  },
];

function hostTransportViolations(repoRel: string, text: string): PackLintViolation[] {
  const code = maskComments(text);
  for (const { target, re } of HOST_TRANSPORT_RULES) {
    const m = re.exec(code);
    if (m) {
      return [withLoc(repoRel, text, m.index, {
        rule: "host-transport-escape",
        target,
        detail: "Packs and plugins/sdk must not call postMessage or import host transport types; use getVizZoto() in the sandbox.",
      })];
    }
  }
  return [];
}

function sandboxViolations(repoRel: string, text: string): PackLintViolation[] {
  const code = maskComments(text);
  for (const { target, re } of SANDBOX_RULES) {
    const m = re.exec(code);
    if (m) {
      return [withLoc(repoRel, text, m.index, { rule: "sandbox-escape", target })];
    }
  }
  return [];
}

function importBoundaryViolations(
  repoRel: string,
  text: string,
  packRepoPrefix: string,
  repoRoot: string,
  importerDirAbs: string,
  packDirAbs?: string,
): PackLintViolation[] {
  const hits: PackLintViolation[] = [];
  for (const site of extractPackImports(text)) {
    if (site.kind === "unverified") {
      hits.push(
        withLoc(repoRel, text, site.index, {
          rule: "unverified-import-call",
          target: site.call === "import" ? "import(non-literal)" : "require(non-literal)",
          detail: site.raw,
        }),
      );
      continue;
    }
    const rule = classifyPackSpecifier(site.specifier, packRepoPrefix, importerDirAbs, repoRoot, packDirAbs);
    if (rule === "ok") continue;
    if (site.kind === "side-effect") {
      hits.push(
        withLoc(repoRel, text, site.index, {
          rule: "side-effect-import",
          target: site.specifier,
        }),
      );
      continue;
    }
    hits.push(
      withLoc(repoRel, text, site.index, {
        rule,
        target: site.specifier,
      }),
    );
  }
  return hits;
}

function inlineZotoDeclare(repoRel: string, text: string): PackLintViolation[] {
  const code = maskComments(text);
  const m = /\bdeclare\s+const\s+zoto\b/.exec(code);
  if (!m) return [];
  return [{
    file: repoRel,
    line: lineColAt(text, m.index).line,
    column: lineColAt(text, m.index).column,
    rule: "inline-zoto-declare",
    target: "declare-const-zoto",
    detail: INLINE_ZOTO_DECLARE_HINT,
  }];
}

function topLevelZotoBinding(repoRel: string, text: string): PackLintViolation[] {
  const code = maskComments(text);
  const hits: PackLintViolation[] = [];
  const re = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+zoto\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const lineStart = code.lastIndexOf("\n", m.index) + 1;
    const lineEnd = code.indexOf("\n", m.index);
    const line = code.slice(lineStart, lineEnd < 0 ? code.length : lineEnd);
    if (/\bdeclare\b/.test(line)) continue;
    hits.push(withLoc(repoRel, text, m.index, {
      rule: "pack-zoto-binding",
      target: "top-level-zoto",
      detail: PACK_ZOTO_BINDING_HINT,
    }));
  }
  return hits;
}

function getConfigInOnFrame(repoRel: string, text: string): PackLintViolation[] {
  const code = maskComments(text);
  const assignRe = /[a-zA-Z_$][\w$]*\.onFrame\s*=\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(code)) !== null) {
    const start = m.index + m[0].length;
    const body = extractBracedBlock(code, start - 1);
    if (body && /\bgetConfig\s*\(/.test(body)) {
      return [{
        file: repoRel,
        line: lineColAt(text, m.index).line,
        rule: "get-config-in-on-frame",
        target: "getConfig()",
      }];
    }
  }
  const fnRe = /[a-zA-Z_$][\w$]*\.onFrame\s*=\s*function\s*\([^)]*\)\s*\{/g;
  while ((m = fnRe.exec(code)) !== null) {
    const start = m.index + m[0].length;
    const body = extractBracedBlock(code, start - 1);
    if (body && /\bgetConfig\s*\(/.test(body)) {
      return [{
        file: repoRel,
        line: lineColAt(text, m.index).line,
        rule: "get-config-in-on-frame",
        target: "getConfig()",
      }];
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

function symlinkViolations(packDirAbs: string, packRepoPrefix: string, repoRoot: string): PackLintViolation[] {
  return packSymlinkEscapes(packDirAbs, packRepoPrefix, repoRoot).map((h) => ({
    file: h.file,
    rule: "host-import" as const,
    target: h.target,
    detail: h.detail,
  }));
}

function lintPackSource(
  repoRel: string,
  text: string,
  packRepoPrefix: string,
  repoRoot: string,
  importerDirAbs: string,
  packDirAbs?: string,
): PackLintViolation[] {
  const merged = [
    ...sandboxViolations(repoRel, text),
    ...hostTransportViolations(repoRel, text),
    ...importBoundaryViolations(repoRel, text, packRepoPrefix, repoRoot, importerDirAbs, packDirAbs),
    ...inlineZotoDeclare(repoRel, text),
    ...topLevelZotoBinding(repoRel, text),
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

import { disallowedHostPackSrcImports, scanService, scanWebSrc } from "./pack-lint-host";

const SDK_SKIP_DIRS = new Set([
  "pack-lint-fixtures",
  "host-lint-fixtures",
  "pack-bundle-fixtures",
  "fixtures",
  "starter-regression",
]);

function listSdkModuleTsFiles(sdkRoot: string, rel = ""): string[] {
  const dir = path.join(sdkRoot, rel);
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SDK_SKIP_DIRS.has(ent.name)) continue;
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (sub === "starter") {
        out.push(...listSdkModuleTsFiles(sdkRoot, `${sub}/frontend`));
        continue;
      }
      out.push(...listSdkModuleTsFiles(sdkRoot, sub));
      continue;
    }
    if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts") && !ent.name.endsWith(".test.ts")) {
      out.push(sub);
    }
  }
  return out;
}

export function scanSdkGuardrails(repoRoot: string): PackLintViolation[] {
  const sdkRoot = path.join(repoRoot, SDK_ROOT);
  const violations: PackLintViolation[] = [];
  for (const rel of listSdkModuleTsFiles(sdkRoot)) {
    const repoRel = `${SDK_ROOT}/${rel}`.replace(/\\/g, "/");
    const abs = path.join(sdkRoot, rel);
    const text = fs.readFileSync(abs, "utf8");
    violations.push(...hostTransportViolations(repoRel, text));
  }
  return violations;
}

export function scanAllGuardrails(repoRoot: string): PackLintViolation[] {
  const merged = [
    ...scanPluginsSrc(repoRoot),
    ...scanSdkGuardrails(repoRoot),
    ...scanWebSrc(repoRoot),
    ...scanService(repoRoot),
  ];
  merged.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.target.localeCompare(b.target);
  });
  return merged;
}

export {
  disallowedHostPackSrcImports,
  HOST_PACK_SRC_IMPORT_ALLOWLIST,
  HOST_PACK_SRC_IMPORT_ALLOWLIST_COUNT,
  isHostCodeRepoPath,
  scanHostLintFixture,
  scanService,
  scanWebSrc,
} from "./pack-lint-host";
export { extractModuleSpecifiers, packSymlinkEscapes } from "./pack-lint-import";

export function scanPluginsSrc(repoRoot: string): PackLintViolation[] {
  const packsRoot = path.join(repoRoot, PACKS_ROOT);
  const violations: PackLintViolation[] = [];
  for (const packId of listPackIds(packsRoot)) {
    const packDir = path.join(packsRoot, packId);
    violations.push(...symlinkViolations(packDir, `plugins/src/${packId}`, repoRoot));
    for (const rel of listPackTsFiles(packsRoot, packId)) {
      const repoRel = path.join(PACKS_ROOT, packId, rel).replace(/\\/g, "/");
      const absFile = path.join(packsRoot, packId, rel);
      const text = fs.readFileSync(absFile, "utf8");
      violations.push(
        ...lintPackSource(repoRel, text, `plugins/src/${packId}`, repoRoot, path.dirname(absFile), packDir),
      );
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
  importerFileAbs?: string,
): PackLintViolation[] {
  const m = repoRel.match(/^(plugins\/(?:src|sdk)\/[^/]+)/);
  const packRepoPrefix = m?.[1] ?? `plugins/src/${packId}`;
  const importerDirAbs = path.join(repoRoot, path.dirname(repoRel));
  const packRootAbs = path.join(repoRoot, packRepoPrefix);
  const packDirAbs = fs.existsSync(packRootAbs) ? packRootAbs : undefined;
  return lintPackSource(repoRel, text, packRepoPrefix, repoRoot, importerDirAbs, packDirAbs);
}

export type ScanPackDirectoryOptions = {
  packId?: string;
  repoPathPrefix?: string;
};

const INSTALL_BLOCK_RULES = new Set<PackLintRule>(["sandbox-escape", "host-transport-escape"]);

const INSTALL_WARN_RULES = new Set<PackLintRule>(["inline-zoto-declare", "pack-zoto-binding"]);

export type PackInstallLintResult = {
  blocks: PackLintViolation[];
  warnings: PackLintViolation[];
};

function packIdFromPluginYml(packDirAbs: string): string | null {
  try {
    const yml = fs.readFileSync(path.join(packDirAbs, "plugin.yml"), "utf8");
    const id = yml.match(/^id:\s*(\S+)/m)?.[1];
    return id ?? null;
  } catch {
    return null;
  }
}

/** Install-time lint for an unpacked pack home. */
export function scanPackInstallLint(packDirAbs: string, repoRoot: string): PackInstallLintResult {
  const packId = packIdFromPluginYml(packDirAbs) ?? path.basename(packDirAbs);
  const violations = scanPackDirectory(packDirAbs, repoRoot, {
    packId,
    repoPathPrefix: `plugins/src/${packId}`,
  });
  const legacyBlocks = legacyZotoViolationsOnDisallowedPacks(violations);
  const legacyBlockKeys = new Set(legacyBlocks.map(violationKey));
  const blocks = [
    ...violations.filter((v) => INSTALL_BLOCK_RULES.has(v.rule)),
    ...legacyBlocks,
  ];
  const warnings = violations.filter(
    (v) => INSTALL_WARN_RULES.has(v.rule) && !legacyBlockKeys.has(violationKey(v)),
  );
  return { blocks, warnings };
}

export function scanPackDirectory(
  packDirAbs: string,
  repoRoot: string,
  opts: ScanPackDirectoryOptions = {},
): PackLintViolation[] {
  const packId = opts.packId ?? path.basename(packDirAbs);
  const repoPrefix = opts.repoPathPrefix ?? `plugins/src/${packId}`;
  const violations: PackLintViolation[] = [...symlinkViolations(packDirAbs, repoPrefix, repoRoot)];
  const walk = (rel: string) => {
    const dir = path.join(packDirAbs, rel);
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(sub);
      else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) {
        const repoRel = `${repoPrefix}/${sub}`.replace(/\\/g, "/");
        const text = fs.readFileSync(path.join(packDirAbs, sub), "utf8");
        violations.push(
          ...lintPackSource(
            repoRel,
            text,
            repoPrefix,
            repoRoot,
            path.dirname(path.join(packDirAbs, sub)),
            packDirAbs,
          ),
        );
      }
    }
  };
  walk("");
  return violations;
}

export function loadBaseline(repoRoot: string): PackLintBaseline {
  const p = path.join(repoRoot, SDK_ROOT, "pack-lint-baseline.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as PackLintBaseline;
}

export function assertBaselineGuard(
  current: PackLintViolation[],
  baseline: PackLintBaseline,
): {
  newViolations: PackLintViolation[];
  staleViolations: PackLintViolation[];
  disallowedLegacyZoto: PackLintViolation[];
  disallowedHostPackSrc: PackLintViolation[];
  ok: boolean;
} {
  const disallowedLegacyZoto = legacyZotoViolationsOnDisallowedPacks(current);
  const disallowedHostPackSrc = disallowedHostPackSrcImports(current);
  const baselineTracked = (v: PackLintViolation) => v.rule !== "host-imports-pack-src";
  const baseSet = new Set(baseline.violations.filter(baselineTracked).map(violationKey));
  const curSet = new Set(current.filter(baselineTracked).map(violationKey));
  const newViolations = current.filter((v) => baselineTracked(v) && !baseSet.has(violationKey(v)));
  const staleViolations = baseline.violations.filter(
    (v) => baselineTracked(v) && !curSet.has(violationKey(v)),
  );
  return {
    newViolations,
    staleViolations,
    disallowedLegacyZoto,
    disallowedHostPackSrc,
    ok:
      disallowedLegacyZoto.length === 0 &&
      disallowedHostPackSrc.length === 0 &&
      newViolations.length === 0 &&
      staleViolations.length === 0,
  };
}

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

export function baselineCountsByRule(baseline: PackLintBaseline): Partial<Record<PackLintRule, number>> {
  const out: Partial<Record<PackLintRule, number>> = {};
  for (const v of baseline.violations) {
    out[v.rule] = (out[v.rule] ?? 0) + 1;
  }
  return out;
}

export function baselineHostPackImports(baseline: PackLintBaseline): string[] {
  return baseline.violations
    .filter((v) => v.rule === "host-imports-pack-src")
    .map((v) => v.file)
    .sort();
}
