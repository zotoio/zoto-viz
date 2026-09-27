/**
 * Shared import extraction and pack-boundary classification (pack + host lint).
 */

import fs from "node:fs";
import path from "node:path";
import type { PackLintRule } from "./pack-lint-types";
import { resolvePackBundleImport } from "./pack-bundle-resolve.mjs";

export const PACK_BOUNDARY_FIX_HINT =
  "Use `import type` from `plugins/sdk/viz-contract`; for runtime helpers use `plugins/sdk/*` (bundled at pack build) or copy the code into your pack.";

/** Mask comments without altering string/template contents (for regex scans). */
export function maskComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < len && source[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < len - 1 && !(source[i] === "*" && source[i + 1] === "/")) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < len - 1) {
        out.push(" ", " ");
        i += 2;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      out.push(ch);
      i++;
      while (i < len) {
        const c = source[i]!;
        out.push(c);
        i++;
        if (c === "\\" && i < len) {
          out.push(source[i]!);
          i++;
          continue;
        }
        if (c === q) break;
      }
      continue;
    }
    if (ch === "`") {
      out.push(ch);
      i++;
      while (i < len) {
        const c = source[i]!;
        out.push(c);
        i++;
        if (c === "\\" && i < len) {
          out.push(source[i]!);
          i++;
          continue;
        }
        if (c === "`") break;
        if (c === "$" && source[i] === "{") {
          out.push("{");
          i++;
          let depth = 1;
          while (i < len && depth > 0) {
            const d = source[i]!;
            out.push(d);
            i++;
            if (d === "{") depth++;
            else if (d === "}") depth--;
          }
        }
      }
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

export function lineColAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function isInStringOrTemplateLiteral(source: string, index: number): boolean {
  let i = 0;
  while (i < index && i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === q) {
          i++;
          break;
        }
        if (i >= index) return true;
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "`") {
          i++;
          break;
        }
        if (c === "$" && source[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (i >= index) return true;
            const d = source[i]!;
            if (d === "{") depth++;
            else if (d === "}") depth--;
            i++;
          }
          continue;
        }
        if (i >= index) return true;
        i++;
      }
      continue;
    }
    i++;
  }
  return false;
}

export function stripImportSuffix(spec: string): string {
  const q = spec.indexOf("?");
  return q >= 0 ? spec.slice(0, q) : spec;
}

export type PackImportKind = "static" | "export-from" | "side-effect" | "dynamic" | "require";

export type ExtractedPackImport =
  | { kind: PackImportKind; specifier: string; index: number }
  | {
      kind: "unverified";
      call: "import" | "require";
      raw: string;
      index: number;
      /** Template import with expressions — normalized for host boundary scans. */
      hostSpec?: string;
    };

function readStringLiteral(source: string, start: number): { value: string; end: number } | null {
  const q = source[start];
  if (q !== "'" && q !== '"') return null;
  let i = start + 1;
  let value = "";
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      value += ch + (source[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === q) return { value, end: i + 1 };
    value += ch;
    i++;
  }
  return null;
}

function readTemplateLiteral(
  source: string,
  start: number,
): { value: string; end: number; hasExpr: boolean } | null {
  if (source[start] !== "`") return null;
  let i = start + 1;
  let value = "";
  let hasExpr = false;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return { value, end: i + 1, hasExpr };
    if (ch === "$" && source[i + 1] === "{") {
      hasExpr = true;
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const c = source[i]!;
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      continue;
    }
    value += ch;
    i++;
  }
  return null;
}

function parseRuntimeCall(
  source: string,
  index: number,
  call: "import" | "require",
): ExtractedPackImport {
  let i = index + call.length;
  while (i < source.length && /\s/.test(source[i]!)) i++;
  if (source[i] !== "(") {
    return { kind: "unverified", call, raw: `${call}(?)`, index };
  }
  i++;
  while (i < source.length && /\s/.test(source[i]!)) i++;
  const ch = source[i];
  if (ch === "'" || ch === '"') {
    const lit = readStringLiteral(source, i);
    if (lit) return { kind: call === "import" ? "dynamic" : "require", specifier: lit.value, index };
  }
  if (ch === "`") {
    const lit = readTemplateLiteral(source, i);
    if (lit) {
      const inner = source.slice(i + 1, lit.end - 1);
      const hostSpec = inner.replace(/\$\{[^}]*\}/g, "*");
      if (lit.hasExpr) {
        return { kind: "unverified", call, raw: `${call}(\`…\${…}\`)`, index, hostSpec };
      }
      return { kind: call === "import" ? "dynamic" : "require", specifier: lit.value, index };
    }
  }
  if (ch === ")") {
    return { kind: "unverified", call, raw: `${call}()`, index };
  }
  const rest = source.slice(i, Math.min(source.length, i + 40)).replace(/\s+/g, " ");
  return { kind: "unverified", call, raw: `${call}(${rest.split(")")[0] ?? "?"})`, index };
}

/** Extract pack-relevant import sites (comment-masked). */
export function extractPackImports(source: string): ExtractedPackImport[] {
  const masked = maskComments(source);
  const out: ExtractedPackImport[] = [];

  const staticRe = /\bimport\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(masked)) !== null) {
    out.push({ kind: "static", specifier: m[1]!, index: m.index });
  }

  const exportRe = /\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+["']([^"']+)["']/g;
  while ((m = exportRe.exec(masked)) !== null) {
    out.push({ kind: "export-from", specifier: m[1]!, index: m.index });
  }

  const sideRe = /\bimport\s+["']([^"']+)["']\s*(?:;|$)/gm;
  while ((m = sideRe.exec(masked)) !== null) {
    const before = masked.slice(Math.max(0, m.index - 12), m.index);
    if (/\bfrom\s*$/i.test(before) || /\bfrom\s+["']/.test(before)) continue;
    out.push({ kind: "side-effect", specifier: m[1]!, index: m.index });
  }

  const callRe = /\b(import|require)\s*\(/g;
  while ((m = callRe.exec(masked)) !== null) {
    const call = m[1] as "import" | "require";
    if (isInStringOrTemplateLiteral(masked, m.index)) continue;
    const prevChar = m.index > 0 ? masked[m.index - 1] : "";
    if (prevChar === ".") continue;
    const prev = masked.slice(Math.max(0, m.index - 8), m.index);
    if (call === "import" && /\bimport\s*$/.test(prev.replace(/^\s+/, ""))) continue;
    out.push(parseRuntimeCall(masked, m.index, call));
  }

  return out;
}

/** Host reverse-boundary: same extractor surface as pack lint. */
export function extractModuleSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const site of extractPackImports(source)) {
    if (site.kind === "unverified") {
      if (site.hostSpec) specs.push(site.hostSpec);
      continue;
    }
    specs.push(site.specifier);
  }
  const globRe = /\bimport\.meta\.glob\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  const masked = maskComments(source);
  while ((m = globRe.exec(masked)) !== null) {
    specs.push(m[1]!);
  }
  return specs;
}

export function isSdkSpecifier(spec: string): boolean {
  const bare = stripImportSuffix(spec);
  if (bare.includes("/plugins/sdk/")) return true;
  return /^(?:\.\.\/)+sdk\//.test(bare);
}

export function isRemoteSpecifier(spec: string): boolean {
  return /^https?:\/\//i.test(stripImportSuffix(spec));
}

export function isViteFsSpecifier(spec: string): boolean {
  return stripImportSuffix(spec).startsWith("/@fs/");
}

export function pathInsidePack(fileAbs: string, packDirAbs: string): boolean {
  try {
    const realFile = fs.realpathSync.native(fileAbs);
    const realPack = fs.realpathSync.native(packDirAbs);
    const rel = path.relative(realPack, realFile);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function resolveRelativeAbs(importerDirAbs: string, bare: string): string {
  let abs = path.normalize(path.join(importerDirAbs, bare));
  for (const ext of [".ts", ".tsx", ".mts", "/index.ts"]) {
    const candidate = ext.startsWith("/") ? `${abs}${ext}` : `${abs}${ext}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return abs;
}

function repoRelFromAbs(absPath: string, repoRoot: string): string | null {
  try {
    const real = fs.realpathSync.native(absPath);
    const repoRel = path.relative(repoRoot, real).replace(/\\/g, "/");
    if (repoRel.startsWith("../")) return null;
    return repoRel;
  } catch {
    return null;
  }
}

export function resolveSpecifierRepoRel(
  spec: string,
  importerDirAbs: string,
  repoRoot: string,
): string | null {
  const bare = stripImportSuffix(spec);
  if (!bare) return null;

  if (isViteFsSpecifier(bare)) {
    let absFs = path.normalize(decodeURIComponent(bare.slice("/@fs/".length)));
    if (!fs.existsSync(absFs)) {
      const idx = absFs.replace(/\\/g, "/").indexOf("plugins/src/");
      if (idx >= 0) absFs = path.join(repoRoot, absFs.slice(idx));
    }
    return repoRelFromAbs(absFs, repoRoot);
  }

  if (isRemoteSpecifier(bare)) {
    try {
      const pathname = new URL(bare).pathname.replace(/\\/g, "/");
      const idx = pathname.indexOf("/plugins/src/");
      if (idx >= 0) {
        return repoRelFromAbs(path.join(repoRoot, pathname.slice(idx + 1)), repoRoot);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (bare.startsWith(".")) {
    const abs = resolveRelativeAbs(importerDirAbs, bare);
    const fromReal = repoRelFromAbs(abs, repoRoot);
    if (fromReal) return fromReal;
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
    return rel.startsWith("../") ? null : rel;
  }

  if (bare.includes("plugins/src/") || bare.startsWith("plugins/src/")) {
    return repoRelFromAbs(path.join(repoRoot, bare.replace(/^\.\/+/, "")), repoRoot);
  }

  return null;
}

/** One classifier for every import form — same specifier → same rule. */
export function classifyPackSpecifier(
  spec: string,
  packRepoPrefix: string,
  importerDirAbs: string,
  repoRoot: string,
  packDirAbs?: string,
): PackLintRule | "ok" {
  const bare = stripImportSuffix(spec);
  const packPrefix = `${packRepoPrefix.replace(/\/$/, "")}/`;
  const packIdFromPrefix = packPrefix.match(/plugins\/src\/([^/]+)\//)?.[1];
  const sdkRootAbs = path.join(repoRoot, "plugins/sdk");

  if (packDirAbs && fs.existsSync(sdkRootAbs)) {
    const importerFile = path.join(importerDirAbs, "_lint_module.ts");
    const bundle = resolvePackBundleImport({
      specifier: spec,
      importerFile,
      packHome: packDirAbs,
      sdkRoot: sdkRootAbs,
      repoRoot,
    });
    if (bundle.ok) return "ok";
    if (
      bundle.code === "remote-import"
      || bundle.code === "vite-fs-import"
      || bundle.code === "absolute-import"
      || bundle.code === "bare-module"
      || bundle.code === "unknown-specifier"
    ) {
      return "host-import";
    }
  } else if (isSdkSpecifier(bare)) {
    return "ok";
  }

  if (bare.includes("web/src/")) return "host-import";

  if (bare.startsWith(".") && packDirAbs) {
    const abs = resolveRelativeAbs(importerDirAbs, bare);
    if (pathInsidePack(abs, packDirAbs)) return "ok";
  }

  if (isRemoteSpecifier(bare)) {
    const resolved = resolveSpecifierRepoRel(bare, importerDirAbs, repoRoot);
    if (resolved?.startsWith("plugins/src/") && packIdFromPrefix && !resolved.startsWith(`plugins/src/${packIdFromPrefix}/`)) {
      return "cross-pack-import";
    }
    return "host-import";
  }

  if (isViteFsSpecifier(bare)) {
    const resolved = resolveSpecifierRepoRel(bare, importerDirAbs, repoRoot);
    if (resolved?.startsWith("plugins/src/")) {
      return packIdFromPrefix && resolved.startsWith(`plugins/src/${packIdFromPrefix}/`) ? "ok" : "cross-pack-import";
    }
    return "host-import";
  }

  const barePack = bare.match(/(?:^|\/)plugins\/src\/([^/]+)/);
  if (barePack && packIdFromPrefix && barePack[1] !== packIdFromPrefix) return "cross-pack-import";

  if (!bare.startsWith(".")) return "ok";

  const resolved = resolveSpecifierRepoRel(bare, importerDirAbs, repoRoot);
  if (!resolved) return "host-import";

  if (resolved.startsWith("plugins/sdk/")) return "ok";
  if (resolved.startsWith(packPrefix)) return "ok";
  if (resolved.startsWith("plugins/src/")) return "cross-pack-import";
  if (resolved.includes("web/src/")) return "host-import";
  return "host-import";
}

export function packSymlinkEscapes(
  packDirAbs: string,
  packRepoPrefix: string,
  repoRoot: string,
): { file: string; target: string; detail: string }[] {
  if (!fs.existsSync(packDirAbs)) return [];
  const packPrefix = `${packRepoPrefix.replace(/\/$/, "")}/`;
  const hits: { file: string; target: string; detail: string }[] = [];

  const walk = (rel: string) => {
    const dir = path.join(packDirAbs, rel);
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(packDirAbs, sub);
      if (ent.isSymbolicLink()) {
        try {
          const real = fs.realpathSync.native(full);
          const repoRel = path.relative(repoRoot, real).replace(/\\/g, "/");
          if (!repoRel.startsWith(packPrefix)) {
            hits.push({
              file: `${packPrefix}${sub}`.replace(/\\/g, "/"),
              target: repoRel,
              detail: `symlink escape → ${ent.name}`,
            });
          }
        } catch {
          hits.push({
            file: `${packPrefix}${sub}`.replace(/\\/g, "/"),
            target: "unresolvable-symlink",
            detail: ent.name,
          });
        }
        continue;
      }
      if (ent.isDirectory()) walk(sub);
    }
  };
  walk("");
  return hits;
}
