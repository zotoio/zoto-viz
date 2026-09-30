/**
 * #192: counts escape hatches in test code for the guard's test-cast row
 * (web/src/tsconfig-test-exclude.test.ts). Code patterns are matched only outside strings and comments;
 * ts-comment directives only inside comments, so prose, string fixtures and regexes don't count.
 * Patterns are built from strings so this file's own source holds none of them.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CODE_PATTERNS: Record<string, RegExp> = {
  "as unknown as": new RegExp(String.raw`\bas\s+unknown\s+as\b`, "g"),
  "as any": new RegExp(String.raw`\bas\s+any\b`, "g"),
  "as never": new RegExp(String.raw`\bas\s+never\b`, "g"),
  ": any": new RegExp(String.raw`:\s*any\b(?!\s*[:(])`, "g"),
};
const COMMENT_PATTERNS: Record<string, RegExp> = {
  "ts-ignore": new RegExp("@" + String.raw`ts-ignore\b`, "g"),
  "ts-expect-error": new RegExp("@" + String.raw`ts-expect-error\b`, "g"),
  "ts-nocheck": new RegExp("@" + String.raw`ts-nocheck\b`, "g"),
};

/** A `/` after one of these (or at the start) opens a regex literal rather than dividing. */
const REGEX_PREV = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

/** Splits TS/JS source into code (strings, template text and regexes blanked) and comment text. */
export function splitCodeAndComments(src: string): { code: string; comments: string } {
  let code = "";
  let comments = "";
  let i = 0;
  const templateDepth: number[] = []; // brace depth at each open `${`
  let braces = 0;
  const lastSignificant = (): string => {
    const t = code.trimEnd();
    return t.length ? t[t.length - 1]! : "";
  };
  const readTemplate = (): void => {
    // at the character after "`" or after the "}" closing a substitution
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === "\\") { code += "  "; i += 2; continue; }
      if (ch === "`") { code += "`"; i++; return; }
      if (ch === "$" && src[i + 1] === "{") { code += "${"; i += 2; templateDepth.push(braces); braces++; return; }
      code += ch === "\n" ? "\n" : " ";
      i++;
    }
  };
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      comments += src.slice(i, stop) + "\n";
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      const body = src.slice(i, stop);
      comments += body + "\n";
      code += body.replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      code += ch;
      i++;
      while (i < src.length && src[i] !== ch && src[i] !== "\n") {
        if (src[i] === "\\") { code += " "; i++; }
        code += " ";
        i++;
      }
      code += src[i] ?? "";
      i++;
      continue;
    }
    if (ch === "`") { code += "`"; i++; readTemplate(); continue; }
    if (ch === "{") { braces++; code += ch; i++; continue; }
    if (ch === "}") {
      braces--;
      if (templateDepth.length && templateDepth[templateDepth.length - 1] === braces) {
        templateDepth.pop();
        code += "}";
        i++;
        readTemplate();
        continue;
      }
      code += ch;
      i++;
      continue;
    }
    if (ch === "/" && (REGEX_PREV.has(lastSignificant()) || REGEX_KEYWORDS.test(code.trimEnd()))) {
      code += "/";
      i++;
      let inClass = false;
      while (i < src.length && src[i] !== "\n") {
        const c = src[i]!;
        if (c === "\\") { code += "  "; i += 2; continue; }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        code += " ";
        i++;
      }
      code += src[i] === "/" ? "/" : "";
      if (src[i] === "/") i++;
      continue;
    }
    code += ch;
    i++;
  }
  return { code, comments };
}

/** Per-pattern hit counts for one source text (patterns with no hits left out). */
export function castHits(src: string): Record<string, number> {
  const { code, comments } = splitCodeAndComments(src);
  const hits: Record<string, number> = {};
  for (const [name, re] of Object.entries(CODE_PATTERNS)) {
    const n = code.match(re)?.length ?? 0;
    if (n) hits[name] = n;
  }
  for (const [name, re] of Object.entries(COMMENT_PATTERNS)) {
    const n = comments.match(re)?.length ?? 0;
    if (n) hits[name] = n;
  }
  return hits;
}

export const CAST_HELPER = "web/test-support/mock-partial.ts";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Test code and test-adjacent code the row scans (repo-relative):
 * - test files (*.test.ts[x]) and __tests__/ under web/src, web/scripts, plugins/src, plugins/sdk;
 * - everything under web/test, web/test-support, web/typecheck, web/assembly and scripts/;
 * - non-test helpers under web/src that exist for tests: files under a test/, fixtures/ or
 *   test-support/ directory, or named *harness*, *fixture*, *.typecheck.ts or *.boundary.ts.
 */
export function isScannedFile(rel: string): boolean {
  if (!SOURCE.test(rel)) return false;
  if (/\.test\.tsx?$/.test(rel) || /(^|\/)__tests__\//.test(rel)) {
    return /^(web\/src|web\/scripts|plugins\/src|plugins\/sdk|scripts)\//.test(rel) || /^web\/(test|test-support)\//.test(rel);
  }
  if (/^(web\/test|web\/test-support|web\/typecheck|web\/assembly|scripts)\//.test(rel)) return true;
  if (/^web\/src\//.test(rel)) {
    return /\/(test|fixtures|test-support)\//.test(rel) || /(harness|fixture)[^/]*$/.test(rel) || /\.(typecheck|boundary)\.ts$/.test(rel);
  }
  return false;
}

export const CAST_SCAN_ROOTS = ["web/src", "web/scripts", "web/test", "web/test-support", "web/typecheck", "web/assembly", "plugins/src", "plugins/sdk", "scripts"];

function walk(repoRoot: string, dir: string, acc: string[]): string[] {
  let entries;
  try {
    entries = readdirSync(path.join(repoRoot, dir), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(repoRoot, rel, acc);
    else if (entry.isFile() && isScannedFile(rel)) acc.push(rel);
  }
  return acc;
}

/** Repo-relative scanned file -> total hits (files with none left out; mockPartial's file exempt). */
export function testCastCounts(repoRoot: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const root of CAST_SCAN_ROOTS) {
    for (const rel of walk(repoRoot, root, [])) {
      if (rel === CAST_HELPER) continue;
      const n = Object.values(castHits(readFileSync(path.join(repoRoot, rel), "utf8"))).reduce((a, b) => a + b, 0);
      if (n > 0) counts.set(rel, n);
    }
  }
  return counts;
}
