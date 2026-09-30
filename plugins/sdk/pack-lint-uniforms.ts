/**
 * Uniform declaration lint (#171 option (b)): a static, GPU-free check that every uniform
 * the JS side binds is declared in the GLSL it is bound to, and every custom uniform a
 * shader stage reads is declared in that stage and set by its binding.
 *
 * Scope: `web/src/**` and `plugins/src/<pack>/frontend/**` TypeScript, plus
 * `plugins/src/<pack>/sky/*.glsl` (bound to the host plugin-sky preamble and the pack's
 * `writeUniform("…")` calls). For packs it also checks that a sky never redeclares a host
 * preamble uniform with a different type, and that every `writeUniform("X")` names a uniform
 * in the pack's plugin.yml `viz.uniforms` (the host drops anything else).
 *
 * CI/pre-push only: imported by `pack-lint-test-support.ts` (the guardrail scan) and tests,
 * never by the install path or any runtime module.
 *
 * "Custom uniform" = an identifier named `u[A-Z]…` or the host UBO `zotoVizSlots`. three.js
 * ShaderLib/ShaderChunk declare no names of that shape, so the three.js prefix and the stock
 * `onBeforeCompile` source never supply one (a test pins this).
 *
 * A program whose GLSL we can't fully resolve (a runtime string such as `${frag}`) is "open":
 * a missing declaration there can't be proved, so no finding is raised for it.
 */

import fs from "node:fs";
import path from "node:path";
import { lineColAt } from "./pack-lint-import";
import type { PackLintViolation } from "./pack-lint-types";

export const UNIFORM_LINT_RULES = [
  /** JS binds a uniform (`uniforms: { X }`, `.uniforms.X`, `getUniformLocation(p, "X")`, `writeUniform("X")`) that its GLSL never declares. */
  "uniform-set-undeclared",
  /** A shader stage reads a custom uniform it never declares (compile failure: #171 Graph Cloth `uEdgeOpacity`). */
  "glsl-uniform-undeclared",
  /** A shader stage declares and reads a custom uniform its binding never sets. */
  "glsl-uniform-unset",
  /** A pack sky declares a uniform the host preamble also declares, with a different type. */
  "uniform-type-conflict",
  /** A pack's `writeUniform("X")` where X isn't in its plugin.yml `viz.uniforms` (the host drops the write). */
  "write-uniform-not-in-manifest",
] as const;

export type UniformLintRule = (typeof UNIFORM_LINT_RULES)[number];

export type UniformLintOptions = {
  /** Rules to switch off (revert proofs). */
  disabledRules?: ReadonlySet<UniformLintRule>;
};

export type GlslStage = "vertex" | "fragment";

export const CUSTOM_UNIFORM_RE = /^(?:u[A-Z]\w*|zotoVizSlots)$/;
const CUSTOM_UNIFORM_SCAN = /\b(u[A-Z]\w*|zotoVizSlots)\b/g;

/** Where the host plugin-sky preamble lives (`wrapPluginSky`); read statically so the lint follows edits. */
export const HOST_SKY_PREAMBLE_SOURCE = {
  file: "web/src/plugins/plugin-sky-probe.ts",
  constName: "preamble",
} as const;

/** Where the pack-writable sky uniform whitelist lives (`PLUGIN_SKY_UNIFORMS`); read statically. */
export const PLUGIN_SKY_UNIFORMS_SOURCE = {
  file: "web/src/plugins/plugin-sky-uniforms.ts",
  constName: "PLUGIN_SKY_UNIFORMS",
} as const;

// ---------------------------------------------------------------------------
// TypeScript lexer: string / template / regex / comment aware.

type TemplatePart = { text: string } | { expr: string; exprStart: number };

export type StringLit = {
  start: number;
  end: number;
  kind: "quote" | "template";
  /** Cooked text for quoted strings; for templates see `parts`. */
  text: string;
  parts: TemplatePart[];
  /** True when a `/* glsl *\/` tag sits right before the literal. */
  tagged: boolean;
};

export type LexedTs = {
  source: string;
  /** Same length as source: comments, string and template text blanked (template `${…}` code kept). */
  masked: string;
  strings: StringLit[];
};

const REGEX_PREV_CHARS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_PREV_WORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "yield", "await", "else", "do"]);

function cook(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, e: string) => {
    switch (e[0]) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "0": return "\0";
      case "\n": return "";
      case "u": return e.length > 1 ? String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ""), 16)) : e;
      case "x": return e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : e;
      default: return e;
    }
  });
}

export function lexTs(source: string): LexedTs {
  const len = source.length;
  const out: string[] = new Array(len);
  const strings: StringLit[] = [];
  let lastSig = "";
  let lastWord = "";
  let afterSpace = false;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) out[k] = source[k] === "\n" ? "\n" : " ";
  };

  const tagBefore = (at: number): boolean => /\/\*\s*glsl\s*\*\/\s*$/.test(source.slice(Math.max(0, at - 40), at));

  const scanQuote = (i: number): number => {
    const q = source[i]!;
    let j = i + 1;
    while (j < len && source[j] !== q && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
    const end = Math.min(len, j + 1);
    out[i] = q;
    blank(i + 1, end - 1);
    if (end - 1 < len) out[end - 1] = source[end - 1]!;
    strings.push({ start: i, end, kind: "quote", text: cook(source.slice(i + 1, end - 1)), parts: [], tagged: tagBefore(i) });
    return end;
  };

  // eslint-disable-next-line prefer-const
  let scanCode: (i: number, stopOnBrace: boolean) => number;

  const scanTemplate = (i: number): number => {
    out[i] = "`";
    const lit: StringLit = { start: i, end: i, kind: "template", text: "", parts: [], tagged: tagBefore(i) };
    strings.push(lit);
    let j = i + 1;
    let chunkStart = j;
    const flush = (to: number) => {
      lit.parts.push({ text: cook(source.slice(chunkStart, to)) });
      blank(chunkStart, to);
    };
    while (j < len) {
      const c = source[j]!;
      if (c === "\\") { j += 2; continue; }
      if (c === "`") break;
      if (c === "$" && source[j + 1] === "{") {
        flush(j);
        out[j] = "$";
        out[j + 1] = "{";
        const exprStart = j + 2;
        const close = scanCode(exprStart, true);
        lit.parts.push({ expr: source.slice(exprStart, close), exprStart });
        if (close < len) out[close] = "}";
        j = close + 1;
        chunkStart = j;
        continue;
      }
      j++;
    }
    flush(Math.min(j, len));
    if (j < len) out[j] = "`";
    lit.end = Math.min(len, j + 1);
    lit.text = lit.parts.map((p) => ("text" in p ? p.text : "")).join("");
    return lit.end;
  };

  const scanRegex = (i: number): number => {
    let j = i + 1;
    let inClass = false;
    while (j < len && source[j] !== "\n") {
      const c = source[j]!;
      if (c === "\\") { j += 2; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      j++;
    }
    j++;
    while (j < len && /[a-z]/i.test(source[j]!)) j++;
    out[i] = "/";
    blank(i + 1, j);
    return j;
  };

  scanCode = (start: number, stopOnBrace: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < len) {
      const ch = source[i]!;
      const next = source[i + 1];
      if (ch === "/" && next === "/") {
        let j = i;
        while (j < len && source[j] !== "\n") j++;
        blank(i, j);
        i = j;
        continue;
      }
      if (ch === "/" && next === "*") {
        let j = i + 2;
        while (j < len - 1 && !(source[j] === "*" && source[j + 1] === "/")) j++;
        j = Math.min(len, j + 2);
        blank(i, j);
        i = j;
        continue;
      }
      if (ch === "'" || ch === '"') {
        i = scanQuote(i);
        lastSig = "x";
        lastWord = "";
        continue;
      }
      if (ch === "`") {
        i = scanTemplate(i);
        lastSig = "x";
        lastWord = "";
        continue;
      }
      if (ch === "/" && (REGEX_PREV_CHARS.has(lastSig) || REGEX_PREV_WORDS.has(lastWord))) {
        i = scanRegex(i);
        lastSig = "x";
        lastWord = "";
        continue;
      }
      if (stopOnBrace) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          if (depth === 0) return i;
          depth--;
        }
      }
      out[i] = ch;
      if (/\s/.test(ch)) {
        afterSpace = true;
      } else {
        if (/[\w$]/.test(ch)) {
          lastWord = /[\w$]/.test(lastSig) && !afterSpace ? lastWord + ch : ch;
        } else {
          lastWord = "";
        }
        lastSig = ch;
        afterSpace = false;
      }
      i++;
    }
    return i;
  };

  scanCode(0, false);
  for (let k = 0; k < len; k++) if (out[k] === undefined) out[k] = source[k]!;
  strings.sort((a, b) => a.start - b.start);
  return { source, masked: out.join(""), strings };
}

/** Index of the bracket closing the one at `open` in masked code, or -1. */
function matchBracket(masked: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const want = pairs[masked[open]!];
  if (!want) return -1;
  const stack: string[] = [want];
  for (let i = open + 1; i < masked.length; i++) {
    const c = masked[i]!;
    if (c in pairs) stack.push(pairs[c]!);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Split masked [from, to) at depth-0 occurrences of `sep`. Returns [start, end) spans. */
function splitTopLevel(masked: string, from: number, to: number, sep: string): [number, number][] {
  const spans: [number, number][] = [];
  let depth = 0;
  let s = from;
  for (let i = from; i < to; i++) {
    const c = masked[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === sep) {
      spans.push([s, i]);
      s = i + 1;
    }
  }
  spans.push([s, to]);
  return spans;
}

/** End of the expression starting at `from` (next depth-0 `;` or `,`, or an unmatched closer). */
function exprEnd(masked: string, from: number, stops = ";,"): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && stops.includes(c)) return i;
  }
  return masked.length;
}

// ---------------------------------------------------------------------------
// GLSL helpers.

const GLSL_TYPE = "(?:float|int|uint|bool|[iub]?vec[234]|mat[234](?:x[234])?|[iu]?sampler\\w+)";
const GLSL_HINT_RE = new RegExp(
  String.raw`\bvoid\s+main\s*\(|\bgl_(?:Position|FragColor|FragCoord)\b|#include\s*<|#version\s+\d|\bprecision\s+(?:high|medium|low)p\b|^\s*(?:uniform|varying|attribute|in|out)\s+(?:(?:highp|mediump|lowp)\s+)?${GLSL_TYPE}\s+\w+`,
  "m",
);

export function looksLikeGlsl(text: string, tagged = false): boolean {
  return tagged || GLSL_HINT_RE.test(text);
}

function stripGlslComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

export type UniformDecl = {
  name: string;
  type: string;
  /** Offset of the `uniform` keyword in the source (comments blanked, so offsets match the source). */
  offset?: number;
};

export function glslUniformDecls(src: string): UniformDecl[] {
  const code = stripGlslComments(src);
  const out: UniformDecl[] = [];
  const plain = /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;{]+);/g;
  let m: RegExpExecArray | null;
  while ((m = plain.exec(code))) {
    for (const part of m[2]!.split(",")) {
      const name = part.trim().match(/^(\w+)/)?.[1];
      if (name) out.push({ name, type: m[1]!, offset: m.index });
    }
  }
  const block = /\buniform\s+\w+\s*\{([^}]*)\}\s*(\w+)?\s*;/g;
  while ((m = block.exec(code))) {
    if (m[2]) {
      out.push({ name: m[2], type: "block", offset: m.index });
      continue;
    }
    for (const f of m[1]!.matchAll(/\b\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g)) out.push({ name: f[1]!, type: "block-member", offset: m.index });
  }
  return out;
}

/** Custom uniform names a GLSL source reads (outside `uniform` declarations, locals and `.field`s). */
export function glslCustomReads(src: string): { name: string; offset: number }[] {
  let code = stripGlslComments(src);
  code = code.replace(/\buniform\b[^;{]*(?:\{[^}]*\}[^;]*)?;/g, (m) => m.replace(/[^\n]/g, " "));
  const locals = new Set<string>();
  const localRe = new RegExp(String.raw`\b(?:${GLSL_TYPE}|void|struct)\s+(u[A-Z]\w*|zotoVizSlots)\b`, "g");
  for (const m of code.matchAll(localRe)) locals.add(m[1]!);
  for (const m of code.matchAll(/#define\s+(u[A-Z]\w*)/g)) locals.add(m[1]!);
  const out: { name: string; offset: number }[] = [];
  const seen = new Set<string>();
  for (const m of code.matchAll(CUSTOM_UNIFORM_SCAN)) {
    const name = m[1]!;
    if (locals.has(name) || seen.has(name)) continue;
    if (code[m.index! - 1] === ".") continue;
    seen.add(name);
    out.push({ name, offset: m.index! });
  }
  return out;
}

function stageOf(src: string): GlslStage {
  return /\bgl_Position\b/.test(src) ? "vertex" : "fragment";
}

// ---------------------------------------------------------------------------
// Resolving GLSL consts (same file, then relative imports).

type Resolved = { glsl: string; open: boolean; consts: Set<string> };

type TsFile = {
  repoRel: string;
  abs: string | null;
  lex: LexedTs;
};

type Ctx = {
  repoRoot: string;
  readFile: (abs: string) => string | null;
  cache: Map<string, TsFile | null>;
};

function loadTs(ctx: Ctx, abs: string): TsFile | null {
  if (ctx.cache.has(abs)) return ctx.cache.get(abs)!;
  const text = ctx.readFile(abs);
  const f = text == null ? null : { repoRel: path.relative(ctx.repoRoot, abs).replace(/\\/g, "/"), abs, lex: lexTs(text) };
  ctx.cache.set(abs, f);
  return f;
}

function stringAt(f: TsFile, at: number): StringLit | undefined {
  return f.lex.strings.find((s) => s.start === at);
}

/** `[start, end)` of the initializer of `const NAME =` (first match), or null. */
function constInit(f: TsFile, name: string): [number, number] | null {
  const re = new RegExp(String.raw`\b(?:const|let|var)\s+${name.replace(/\$/g, "\\$")}\s*(?::[^=;]+)?=\s*`, "g");
  const m = re.exec(f.lex.masked);
  if (!m) return null;
  const s = m.index + m[0].length;
  return [s, exprEnd(f.lex.masked, s, ";")];
}

function importSource(f: TsFile, name: string): { spec: string; imported: string } | null {
  const re = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(["'])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f.lex.masked))) {
    for (const part of m[1]!.split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const imported = bits[0]!.replace(/^type\s+/, "").trim();
      const local = (bits[1] ?? imported).trim();
      if (local !== name) continue;
      const lit = stringAt(f, m.index + m[0].length - 1);
      if (!lit) return null;
      return { spec: lit.text, imported };
    }
  }
  return null;
}

function resolveImport(ctx: Ctx, f: TsFile, spec: string): TsFile | null {
  if (!f.abs || !spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(f.abs), spec);
  for (const cand of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (/\.ts$/.test(cand)) {
      const got = loadTs(ctx, cand);
      if (got) return got;
    }
  }
  return null;
}

function objectProp(f: TsFile, objName: string, prop: string, ctx: Ctx, depth: number): string | null {
  let target: TsFile | null = f;
  let name = objName;
  let span = constInit(f, objName);
  if (!span) {
    const imp = importSource(f, objName);
    if (!imp || depth > 4) return null;
    target = resolveImport(ctx, f, imp.spec);
    if (!target) return null;
    name = imp.imported;
    span = constInit(target, name);
    if (!span) return null;
  }
  const m = target.lex.masked;
  const open = m.indexOf("{", span[0]);
  if (open < 0 || open >= span[1]) return null;
  const close = matchBracket(m, open);
  const body = m.slice(open, close);
  const pm = new RegExp(String.raw`[{,]\s*${prop}\s*:\s*`).exec(body);
  if (!pm) return null;
  const vs = open + pm.index + pm[0].length;
  const lit = stringAt(target, vs);
  if (lit && lit.kind === "quote") return lit.text;
  const num = target.lex.source.slice(vs, exprEnd(m, vs)).trim();
  return /^-?\d[\d_.]*$/.test(num) ? num.replace(/_/g, "") : null;
}

function resolveTemplate(ctx: Ctx, f: TsFile, lit: StringLit, depth: number): Resolved {
  if (lit.kind === "quote") return { glsl: lit.text, open: false, consts: new Set() };
  let glsl = "";
  let open = false;
  const consts = new Set<string>();
  for (const p of lit.parts) {
    if ("text" in p) {
      glsl += p.text;
      continue;
    }
    const r = resolveExpr(ctx, f, p.expr.trim(), depth + 1, true);
    glsl += r.glsl;
    open ||= r.open;
    for (const c of r.consts) consts.add(c);
  }
  return { glsl, open, consts };
}

/** Resolve a TS expression to GLSL text. `interp` = inside a template `${…}` (non-name expressions become values). */
function resolveExpr(ctx: Ctx, f: TsFile, expr: string, depth: number, interp: boolean): Resolved {
  const none = (open: boolean): Resolved => ({ glsl: interp ? " 0.0 " : "", open, consts: new Set() });
  if (depth > 8) return none(true);
  const e = expr.trim().replace(/\s+as\s+\w[\w.<>[\]]*$/, "").replace(/^\((.*)\)$/s, "$1").trim();
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const span = constInit(f, e);
    if (span) {
      const r = resolveSpan(ctx, f, span[0], span[1], depth + 1);
      r.consts.add(`${f.repoRel}#${e}`);
      return r;
    }
    const imp = importSource(f, e);
    if (imp) {
      const target = resolveImport(ctx, f, imp.spec);
      if (target) {
        const s2 = constInit(target, imp.imported);
        if (s2) return resolveSpan(ctx, target, s2[0], s2[1], depth + 1);
      }
    }
    return none(true);
  }
  const mem = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(e);
  if (mem) {
    const v = objectProp(f, mem[1]!, mem[2]!, ctx, depth);
    if (v != null) return { glsl: v, open: false, consts: new Set() };
    return none(true);
  }
  return none(!interp);
}

/** Resolve a masked span that is a `+` concatenation of literals / names. */
function resolveSpan(ctx: Ctx, f: TsFile, from: number, to: number, depth: number): Resolved {
  const out: Resolved = { glsl: "", open: false, consts: new Set() };
  for (const [s, t] of splitTopLevel(f.lex.masked, from, to, "+")) {
    let a = s;
    while (a < t && /\s/.test(f.lex.masked[a]!)) a++;
    const lit = stringAt(f, a);
    let r: Resolved;
    if (lit && f.lex.source.slice(lit.end, t).trim() === "") r = resolveTemplate(ctx, f, lit, depth);
    else r = resolveExpr(ctx, f, f.lex.source.slice(a, t), depth, false);
    out.glsl += r.glsl;
    out.open ||= r.open;
    for (const c of r.consts) out.consts.add(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Program sites.

type StageSrc = { stage: GlslStage; glsl: string; open: boolean; line: number };

type SetSite = { name: string; line: number };

type Program = {
  label: string;
  line: number;
  stages: StageSrc[];
  /** Names the JS binding sets; null = can't enumerate (spread, runtime object). */
  sets: SetSite[] | null;
  /** Declarations the host/three.js prepends (pack sky preamble). */
  prefixDecls: UniformDecl[];
  /** Names the host always sets for this program (pack sky preamble). */
  hostSets: Set<string>;
  receivers: string[];
};

function lineOf(f: TsFile, at: number): number {
  return lineColAt(f.lex.source, at).line;
}

/** Keys of an object literal whose `{` is at `open` (masked). null = has spread/unknown keys. */
function objectKeys(ctx: Ctx, f: TsFile, open: number): SetSite[] | null {
  const m = f.lex.masked;
  const close = matchBracket(m, open);
  if (close < 0) return null;
  const out: SetSite[] = [];
  for (const [s, t] of splitTopLevel(m, open + 1, close, ",")) {
    const seg = m.slice(s, t);
    if (!seg.trim()) continue;
    const lead = s + (seg.length - seg.trimStart().length);
    if (seg.trim().startsWith("...")) return null;
    const lit = stringAt(f, lead);
    if (lit) {
      out.push({ name: lit.text, line: lineOf(f, lead) });
      continue;
    }
    const id = /^\s*([A-Za-z_$][\w$]*)\s*[:(,]?/.exec(seg);
    if (id && !seg.trim().startsWith("[")) {
      out.push({ name: id[1]!, line: lineOf(f, lead) });
      continue;
    }
    const comp = /^\s*\[([^\]]+)\]\s*:/.exec(seg);
    if (comp) {
      const r = resolveExpr(ctx, f, f.lex.source.slice(lead + 1, lead + 1 + comp[1]!.length), 0, false);
      if (r.open || !r.glsl) return null;
      out.push({ name: r.glsl, line: lineOf(f, lead) });
      continue;
    }
    return null;
  }
  return out;
}

/** Resolve `uniforms:` value: object literal, or `this.fn()` / `fn()` returning one. */
function uniformsValueKeys(ctx: Ctx, f: TsFile, valueStart: number, valueEnd: number): SetSite[] | null {
  const m = f.lex.masked;
  let a = valueStart;
  while (a < valueEnd && /\s/.test(m[a]!)) a++;
  if (m[a] === "{") return objectKeys(ctx, f, a);
  const call = /^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*$/.exec(m.slice(a, valueEnd).trim());
  if (!call) return null;
  const def = new RegExp(String.raw`(?:^|[\s;}])(?:private\s+|public\s+|protected\s+|static\s+)*(?:function\s+)?${call[1]}\s*\([^)]*\)\s*(?::[^{]+)?\{`, "g").exec(m);
  if (!def) return null;
  const bodyOpen = def.index + def[0].length - 1;
  const bodyClose = matchBracket(m, bodyOpen);
  const ret = /\breturn\s*\{/.exec(m.slice(bodyOpen, bodyClose));
  if (!ret) return null;
  return objectKeys(ctx, f, bodyOpen + ret.index + ret[0].length - 1);
}

function receiverBefore(f: TsFile, at: number): string[] {
  const before = f.lex.masked.slice(Math.max(0, at - 200), at);
  const assign = /((?:this\.)?[A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
  if (assign) return [assign[1]!];
  if (/\breturn\s*$/.test(before)) {
    const fns = [...f.lex.masked.slice(0, at).matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)];
    const fn = fns[fns.length - 1]?.[1];
    if (!fn) return [];
    const recv = [...f.lex.masked.matchAll(new RegExp(String.raw`((?:this\.)?[A-Za-z_$][\w$]*)\s*=\s*${fn}\s*\(`, "g"))].map((x) => x[1]!);
    return recv;
  }
  return [];
}

function materialPrograms(ctx: Ctx, f: TsFile): Program[] {
  const m = f.lex.masked;
  const out: Program[] = [];
  for (const hit of m.matchAll(/\bnew\s+(?:THREE\.)?(?:Raw)?ShaderMaterial\s*\(\s*\{/g)) {
    const open = hit.index! + hit[0].length - 1;
    const close = matchBracket(m, open);
    if (close < 0) continue;
    const prog: Program = {
      label: "ShaderMaterial",
      line: lineOf(f, hit.index!),
      stages: [],
      sets: [],
      prefixDecls: [],
      hostSets: new Set(),
      receivers: receiverBefore(f, hit.index!),
    };
    let sawUniforms = false;
    for (const [s, t] of splitTopLevel(m, open + 1, close, ",")) {
      const kv = /^\s*(uniforms|vertexShader|fragmentShader)\s*(:)?/.exec(m.slice(s, t));
      if (!kv) continue;
      const valueStart = kv[2] ? s + kv[0].length : s;
      if (kv[1] === "uniforms") {
        sawUniforms = true;
        prog.sets = kv[2] ? uniformsValueKeys(ctx, f, valueStart, t) : null;
        continue;
      }
      const stage: GlslStage = kv[1] === "vertexShader" ? "vertex" : "fragment";
      const r = kv[2] ? resolveSpan(ctx, f, valueStart, t, 0) : resolveExpr(ctx, f, kv[1]!, 0, false);
      prog.stages.push({ stage, glsl: r.glsl, open: r.open, line: lineOf(f, valueStart) });
      for (const c of r.consts) consumed.add(c);
    }
    if (!sawUniforms) prog.sets = [];
    out.push(prog);
  }
  return out;
}

/** Module-level scratch: GLSL consts a program consumed (skip them as orphan shaders). */
let consumed = new Set<string>();

function onBeforeCompilePrograms(ctx: Ctx, f: TsFile): { progs: Program[]; spans: [number, number][] } {
  const m = f.lex.masked;
  const progs: Program[] = [];
  const spans: [number, number][] = [];
  const re = /\.onBeforeCompile\s*=\s*(?:function\s*[\w$]*\s*)?\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*(?::[^={]+)?(?:=>\s*)?\{/g;
  for (const hit of m.matchAll(re)) {
    const p = hit[1]!;
    const bodyOpen = hit.index! + hit[0].length - 1;
    const bodyClose = matchBracket(m, bodyOpen);
    if (bodyClose < 0) continue;
    spans.push([bodyOpen, bodyClose]);
    const body = m.slice(bodyOpen, bodyClose);
    const sets: SetSite[] = [];
    let setsOpen = false;
    for (const s of body.matchAll(new RegExp(String.raw`\b${p}\.uniforms\.([A-Za-z_$][\w$]*)\s*=[^=]`, "g"))) {
      sets.push({ name: s[1]!, line: lineOf(f, bodyOpen + s.index!) });
    }
    for (const s of body.matchAll(new RegExp(String.raw`\b${p}\.uniforms\[\s*(?=["'])`, "g"))) {
      const lit = stringAt(f, bodyOpen + s.index! + s[0].length);
      if (lit) sets.push({ name: lit.text, line: lineOf(f, lit.start) });
      else setsOpen = true;
    }
    for (const s of body.matchAll(new RegExp(String.raw`\bObject\.assign\(\s*${p}\.uniforms\s*,\s*\{`, "g"))) {
      const keys = objectKeys(ctx, f, bodyOpen + s.index! + s[0].length - 1);
      if (keys) sets.push(...keys);
      else setsOpen = true;
    }
    const byStage: Record<GlslStage, StageSrc> = {
      vertex: { stage: "vertex", glsl: "", open: false, line: 0 },
      fragment: { stage: "fragment", glsl: "", open: false, line: 0 },
    };
    for (const s of body.matchAll(new RegExp(String.raw`\b${p}\.(vertexShader|fragmentShader)\s*=[^=]`, "g"))) {
      const stage: GlslStage = s[1] === "vertexShader" ? "vertex" : "fragment";
      const from = bodyOpen + s.index! + s[0].length - 1;
      const to = exprEnd(m, from, ";");
      const st = byStage[stage];
      if (!st.line) st.line = lineOf(f, from);
      for (const lit of f.lex.strings) {
        if (lit.start < from || lit.end > to) continue;
        if (f.lex.strings.some((o) => o !== lit && o.start < lit.start && o.end > lit.end)) continue;
        const r = resolveTemplate(ctx, f, lit, 0);
        st.glsl += `\n${r.glsl}`;
        st.open ||= r.open;
        for (const c of r.consts) consumed.add(c);
      }
      for (const id of m.slice(from, to).matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$(])/g)) {
        const name = id[1]!;
        const idAt = from + id.index!;
        if (f.lex.strings.some((l) => idAt > l.start && idAt < l.end)) continue;
        if (name === p || /^(?:replace|vertexShader|fragmentShader|true|false|null|undefined)$/.test(name)) continue;
        const r = resolveExpr(ctx, f, name, 0, false);
        if (r.open) continue;
        st.glsl += `\n${r.glsl}`;
        for (const c of r.consts) consumed.add(c);
      }
    }
    progs.push({
      label: "onBeforeCompile",
      line: lineOf(f, hit.index!),
      stages: [byStage.vertex, byStage.fragment].filter((s) => s.line > 0),
      sets: setsOpen ? null : sets,
      prefixDecls: [],
      hostSets: new Set(),
      receivers: [],
    });
  }
  return { progs, spans };
}

function glslLiterals(ctx: Ctx, f: TsFile): { lit: StringLit; r: Resolved }[] {
  const out: { lit: StringLit; r: Resolved }[] = [];
  for (const lit of f.lex.strings) {
    if (!looksLikeGlsl(lit.text, lit.tagged)) continue;
    out.push({ lit, r: resolveTemplate(ctx, f, lit, 0) });
  }
  return out;
}

function rawGlProgram(ctx: Ctx, f: TsFile, lits: { lit: StringLit; r: Resolved }[]): Program | null {
  const m = f.lex.masked;
  const sets: SetSite[] = [];
  for (const hit of m.matchAll(/\bgetUniformLocation\s*\(/g)) {
    const open = hit.index! + hit[0].length - 1;
    const close = matchBracket(m, open);
    const args = splitTopLevel(m, open + 1, close, ",");
    const second = args[1];
    if (!second) continue;
    let a = second[0];
    while (a < second[1] && /\s/.test(m[a]!)) a++;
    const lit = stringAt(f, a);
    if (lit && lit.kind === "quote") sets.push({ name: lit.text, line: lineOf(f, a) });
  }
  if (sets.length === 0) return null;
  const stages: StageSrc[] = lits
    .filter(({ r }) => /\bvoid\s+main\s*\(/.test(r.glsl) || r.open)
    .map(({ lit, r }) => ({ stage: stageOf(r.glsl), glsl: r.glsl, open: r.open, line: lineOf(f, lit.start) }));
  return { label: "getUniformLocation", line: sets[0]!.line, stages, sets, prefixDecls: [], hostSets: new Set(), receivers: [] };
}

// ---------------------------------------------------------------------------
// Checks.

type Emit = (v: PackLintViolation) => void;

function checkProgram(repoRel: string, prog: Program, emit: Emit, opts: UniformLintOptions): void {
  const off = opts.disabledRules ?? new Set();
  const allOpen = prog.stages.some((s) => s.open);
  const declared = new Set<string>(prog.prefixDecls.map((d) => d.name));
  for (const s of prog.stages) for (const d of glslUniformDecls(s.glsl)) declared.add(d.name);
  if (!off.has("uniform-set-undeclared") && prog.sets && !allOpen && prog.stages.length > 0) {
    const seen = new Set<string>();
    for (const s of prog.sets) {
      if (declared.has(s.name) || seen.has(s.name)) continue;
      seen.add(s.name);
      emit({
        file: repoRel, line: s.line, rule: "uniform-set-undeclared", target: s.name,
        detail: `${prog.label} (line ${prog.line}) sets ${s.name} but no stage declares \`uniform … ${s.name};\``,
      });
    }
  }
  const setNames = new Set<string>([...prog.hostSets, ...(prog.sets ?? []).map((s) => s.name)]);
  for (const st of prog.stages) {
    const stageDecl = new Set<string>([...prog.prefixDecls.map((d) => d.name), ...glslUniformDecls(st.glsl).map((d) => d.name)]);
    for (const read of glslCustomReads(st.glsl)) {
      if (!stageDecl.has(read.name)) {
        if (st.open || off.has("glsl-uniform-undeclared")) continue;
        emit({
          file: repoRel, line: st.line, rule: "glsl-uniform-undeclared", target: `${st.stage}:${read.name}`,
          detail: `${st.stage} shader reads undeclared uniform ${read.name} (${prog.label}, line ${prog.line})`,
        });
        continue;
      }
      if (off.has("glsl-uniform-unset") || prog.sets === null) continue;
      if (!setNames.has(read.name)) {
        emit({
          file: repoRel, line: st.line, rule: "glsl-uniform-unset", target: `${st.stage}:${read.name}`,
          detail: `${st.stage} shader declares and reads ${read.name} but ${prog.label} (line ${prog.line}) never sets it`,
        });
      }
    }
  }
}

function dedupe(vs: PackLintViolation[]): PackLintViolation[] {
  const seen = new Set<string>();
  return vs.filter((v) => {
    const k = `${v.file}\0${v.rule}\0${v.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function defaultCtx(repoRoot: string, overrides?: Map<string, string>): Ctx {
  return {
    repoRoot,
    cache: new Map(),
    readFile: (abs) => {
      if (overrides?.has(abs)) return overrides.get(abs)!;
      try {
        return fs.readFileSync(abs, "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** Lint one TypeScript source (`repoRel` names it in findings; relative imports resolve from there). */
export function lintUniformsTs(
  repoRel: string,
  text: string,
  repoRoot: string,
  opts: UniformLintOptions = {},
): PackLintViolation[] {
  const abs = path.join(repoRoot, repoRel);
  const ctx = defaultCtx(repoRoot, new Map([[abs, text]]));
  return sortViolations(lintTsFile(ctx, abs, repoRel, opts));
}

function sortViolations(vs: PackLintViolation[]): PackLintViolation[] {
  return vs.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.target.localeCompare(b.target));
}

type TsPrograms = {
  f: TsFile;
  lits: { lit: StringLit; r: Resolved }[];
  mats: Program[];
  obc: Program[];
  obcSpans: [number, number][];
  raw: Program | null;
};

function collectTsPrograms(ctx: Ctx, abs: string, repoRel: string): TsPrograms | null {
  const f = loadTs(ctx, abs);
  if (!f) return null;
  f.repoRel = repoRel;
  consumed = new Set();
  const lits = glslLiterals(ctx, f);
  if (lits.length === 0) return null;
  const mats = materialPrograms(ctx, f);
  const { progs: obc, spans: obcSpans } = onBeforeCompilePrograms(ctx, f);
  const raw = rawGlProgram(ctx, f, lits);
  return { f, lits, mats, obc, obcSpans, raw };
}

export type UniformProgramSummary = {
  label: string;
  line: number;
  sets: string[] | null;
  stages: { stage: GlslStage; open: boolean; declares: string[]; reads: string[] }[];
};

/** What the lint sees in one TS source (tests pin this so a green run is never vacuous). */
export function describeUniformPrograms(repoRel: string, text: string, repoRoot: string): UniformProgramSummary[] {
  const abs = path.join(repoRoot, repoRel);
  const ctx = defaultCtx(repoRoot, new Map([[abs, text]]));
  const got = collectTsPrograms(ctx, abs, repoRel);
  if (!got) return [];
  return [...got.mats, ...got.obc, ...(got.raw ? [got.raw] : [])].map((p) => ({
    label: p.label,
    line: p.line,
    sets: p.sets ? [...new Set(p.sets.map((x) => x.name))].sort() : null,
    stages: p.stages.map((s) => ({
      stage: s.stage,
      open: s.open,
      declares: glslUniformDecls(s.glsl).map((d) => d.name).filter((n) => CUSTOM_UNIFORM_RE.test(n)).sort(),
      reads: glslCustomReads(s.glsl).map((r) => r.name).sort(),
    })),
  }));
}

/** `const mat = this.pluginMat;` → `this.pluginMat` for the nearest alias before `at`. */
function aliasOf(f: TsFile, recv: string, at: number): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(recv)) return recv;
  const hits = [...f.lex.masked.slice(0, at).matchAll(new RegExp(String.raw`\b(?:const|let)\s+${recv}\s*(?::[^=;]+)?=\s*((?:this\.)?[A-Za-z_$][\w$]*)\s*;`, "g"))];
  return hits.length ? hits[hits.length - 1]![1]! : recv;
}

function lintTsFile(ctx: Ctx, abs: string, repoRel: string, opts: UniformLintOptions): PackLintViolation[] {
  const got = collectTsPrograms(ctx, abs, repoRel);
  if (!got) return [];
  const { f, lits, mats, obc, obcSpans, raw } = got;
  const out: PackLintViolation[] = [];
  const emit: Emit = (v) => out.push(v);
  const programs = [...mats, ...obc, ...(raw ? [raw] : [])];
  for (const p of programs) checkProgram(repoRel, p, emit, opts);

  // `.uniforms.X` / `.uniforms["X"]` member access outside onBeforeCompile bodies.
  if (!opts.disabledRules?.has("uniform-set-undeclared")) {
    const fileDecl = new Set<string>();
    let fileOpen = programs.some((p) => p.stages.length === 0 || p.stages.some((st) => st.open));
    for (const { r } of lits) {
      for (const d of glslUniformDecls(r.glsl)) fileDecl.add(d.name);
      fileOpen ||= r.open;
    }
    const m = f.lex.masked;
    for (const hit of m.matchAll(/([\w$.)\]]*?)\.uniforms(?:\.([A-Za-z_$][\w$]*)|\[\s*(?=["']))/g)) {
      const at = hit.index!;
      if (obcSpans.some(([a, b]) => at > a && at < b)) continue;
      let name = hit[2];
      if (!name) {
        const lit = stringAt(f, at + hit[0].length);
        if (!lit) continue;
        name = lit.text;
      }
      if (name === "value") continue;
      const recv = aliasOf(f, hit[1]!, at);
      const prog = mats.find((p) => p.receivers.includes(recv));
      let decl = fileDecl;
      let open = fileOpen;
      if (prog) {
        decl = new Set(prog.stages.flatMap((s) => glslUniformDecls(s.glsl).map((d) => d.name)));
        open = prog.stages.some((s) => s.open) || prog.stages.length === 0;
      }
      if (open || decl.has(name)) continue;
      out.push({
        file: repoRel, line: lineOf(f, at), rule: "uniform-set-undeclared", target: name,
        detail: `${recv || "material"}.uniforms.${name} is bound but no GLSL ${prog ? `for ${prog.label} (line ${prog.line})` : "in this file"} declares it`,
      });
    }
  }

  // Orphan complete shaders (a const with `void main` no program consumed): reads must be
  // declared in the same string, or in every statement that composes it with other GLSL.
  if (!opts.disabledRules?.has("glsl-uniform-undeclared")) {
    for (const { lit, r } of lits) {
      if (!/\bvoid\s+main\s*\(/.test(r.glsl)) continue;
      if (mats.some((p) => p.stages.some((s) => s.glsl.includes(r.glsl))) || obc.some((p) => p.stages.some((s) => s.glsl.includes(r.glsl)))) continue;
      if (raw && raw.stages.some((s) => s.glsl === r.glsl)) {
        // raw GL stages are checked through the getUniformLocation program
        continue;
      }
      const constName = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:\/\*\s*glsl\s*\*\/\s*)?$/.exec(
        f.lex.source.slice(Math.max(0, lit.start - 120), lit.start),
      )?.[1];
      if (constName && consumed.has(`${repoRel}#${constName}`)) continue;
      const compositions: Resolved[] = [];
      if (constName) {
        const refs = [...f.lex.masked.matchAll(new RegExp(String.raw`(?<![\w$.])${constName}(?![\w$])`, "g"))]
          .map((x) => x.index!)
          .filter((i) => i < lit.start - 120 || i > lit.end);
        const exported = new RegExp(String.raw`\bexport\s+(?:const|let|var)\s+${constName}\b`).test(f.lex.masked);
        if (refs.length === 0 && exported) continue;
        for (const ref of refs) {
          let s = ref;
          while (s > 0 && !";{}(,=".includes(f.lex.masked[s - 1]!) && !/\breturn\s$/.test(f.lex.masked.slice(s - 7, s))) s--;
          const e = exprEnd(f.lex.masked, ref, ";,");
          compositions.push(resolveSpan(ctx, f, s, e, 0));
        }
      }
      if (compositions.length === 0) compositions.push(r);
      const stage = stageOf(r.glsl);
      for (const comp of compositions) {
        const decl = new Set(glslUniformDecls(comp.glsl).map((d) => d.name));
        for (const read of glslCustomReads(r.glsl)) {
          if (decl.has(read.name) || comp.open || r.open) continue;
          out.push({
            file: repoRel, line: lineOf(f, lit.start), rule: "glsl-uniform-undeclared", target: `${stage}:${read.name}`,
            detail: `${stage} shader${constName ? ` ${constName}` : ""} reads undeclared uniform ${read.name}`,
          });
        }
      }
    }
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Pack skies.

let preambleCache: { root: string; decls: UniformDecl[] } | null = null;

/** Declarations the host prepends to every plugin sky (`wrapPluginSky`), read from source. */
export function hostSkyPreambleDecls(repoRoot: string): UniformDecl[] {
  if (preambleCache?.root === repoRoot) return preambleCache.decls;
  const ctx = defaultCtx(repoRoot);
  const abs = path.join(repoRoot, HOST_SKY_PREAMBLE_SOURCE.file);
  const f = loadTs(ctx, abs);
  const span = f && constInit(f, HOST_SKY_PREAMBLE_SOURCE.constName);
  if (!f || !span) throw new Error(`uniform lint: host sky preamble not found at ${HOST_SKY_PREAMBLE_SOURCE.file}`);
  const r = resolveSpan(ctx, f, span[0], span[1], 0);
  if (r.open) throw new Error("uniform lint: host sky preamble has an unresolved interpolation");
  const decls = glslUniformDecls(r.glsl);
  preambleCache = { root: repoRoot, decls };
  return decls;
}

let skyUniformsCache: { root: string; names: string[] } | null = null;

/** Sky uniforms a pack may write (`PLUGIN_SKY_UNIFORMS`, the default `viz.uniforms`), read from source. */
export function pluginSkyUniformNames(repoRoot: string): string[] {
  if (skyUniformsCache?.root === repoRoot) return skyUniformsCache.names;
  const ctx = defaultCtx(repoRoot);
  const f = loadTs(ctx, path.join(repoRoot, PLUGIN_SKY_UNIFORMS_SOURCE.file));
  const span = f && constInit(f, PLUGIN_SKY_UNIFORMS_SOURCE.constName);
  if (!f || !span) throw new Error(`uniform lint: ${PLUGIN_SKY_UNIFORMS_SOURCE.constName} not found at ${PLUGIN_SKY_UNIFORMS_SOURCE.file}`);
  const names = f.lex.strings.filter((l) => l.start >= span[0] && l.end <= span[1] && l.kind === "quote").map((l) => l.text);
  if (names.length === 0) throw new Error(`uniform lint: ${PLUGIN_SKY_UNIFORMS_SOURCE.constName} is empty or not a literal array`);
  skyUniformsCache = { root: repoRoot, names };
  return names;
}

export type PackManifestUniforms = {
  /** Uniforms the host contract accepts from `writeUniform` (anything else returns ok:false and is dropped). */
  uniforms: string[];
  /** `list` = `viz.uniforms` given; `default` = viz contract without a list (all sky uniforms); `no-viz` = no usable viz contract. */
  source: "list" | "default" | "no-viz";
};

/** Children of a YAML block mapping: `key → { inline value, child lines }` (minimal: enough for plugin.yml `viz`). */
function yamlBlockChildren(lines: string[]): Map<string, { value: string; lines: string[] }> {
  const out = new Map<string, { value: string; lines: string[] }>();
  const indentOf = (l: string) => l.length - l.trimStart().length;
  const meaningful = lines.filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (meaningful.length === 0) return out;
  const indent = indentOf(meaningful[0]!);
  let cur: { value: string; lines: string[] } | null = null;
  for (const l of meaningful) {
    const ind = indentOf(l);
    if (ind === indent && /^\s*-(?:\s|$)/.test(l) && cur) {
      // Compact sequence (`key:` then `- item` at the key's own indent).
      cur.lines.push(l);
    } else if (ind === indent) {
      const kv = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(l);
      cur = kv ? { value: kv[2]!.replace(/\s+#.*$/, "").trim(), lines: [] } : null;
      if (kv && cur) out.set(kv[1]!, cur);
    } else if (ind > indent && cur) {
      cur.lines.push(l);
    } else if (ind < indent) break;
  }
  return out;
}

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The host's effective `viz.uniforms` for a plugin.yml (mirrors `parseVizContractResult`: a viz contract
 * needs `graphWalk: false` and an `idle` block; no list means every sky uniform; names outside
 * `PLUGIN_SKY_UNIFORMS` are filtered out). A row pins this against the host parser for every shipped pack.
 */
export function manifestVizUniforms(pluginYml: string, repoRoot: string): PackManifestUniforms {
  const sky = pluginSkyUniformNames(repoRoot);
  const lines = pluginYml.split(/\r?\n/);
  const at = lines.findIndex((l) => /^viz\s*:\s*(?:#.*)?$/.test(l));
  if (at < 0) return { uniforms: [], source: "no-viz" };
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && !/^\s/.test(l) && !l.trim().startsWith("#")) break;
    body.push(l);
  }
  const viz = yamlBlockChildren(body);
  if (viz.get("graphWalk")?.value !== "false" || !viz.has("idle")) return { uniforms: [], source: "no-viz" };
  const u = viz.get("uniforms");
  // Missing, `uniforms:` with nothing under it (null) or a scalar: not an array, so the host uses the default list.
  if (!u || (!u.value && u.lines.length === 0)) return { uniforms: [...sky], source: "default" };
  let listed: string[];
  if (u.value.startsWith("[")) {
    listed = u.value.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
  } else if (!u.value) {
    listed = u.lines.map((l) => /^\s*-\s*(.+?)\s*(?:#.*)?$/.exec(l)?.[1]).filter((x): x is string => !!x).map(unquote);
  } else {
    return { uniforms: [...sky], source: "default" };
  }
  return { uniforms: listed.filter((n) => sky.includes(n)), source: "list" };
}

export type PackSkyInput = {
  packId: string;
  /** Repo-relative path → GLSL source for each `sky/*.glsl`. */
  skies: { repoRel: string; glsl: string }[];
  /** Repo-relative path → TS source for each non-test frontend file. */
  frontend: { repoRel: string; text: string }[];
  /** The pack's plugin.yml (null/absent = not provided; the manifest rule is skipped). */
  manifest?: { repoRel: string; text: string } | null;
};

/**
 * Lint one pack: sky GLSL against the host preamble (declarations, types), and `writeUniform("X")`
 * against the sky and the pack's plugin.yml `viz.uniforms`.
 */
export function lintPackUniforms(input: PackSkyInput, repoRoot: string, opts: UniformLintOptions = {}): PackLintViolation[] {
  const off = opts.disabledRules ?? new Set();
  const preamble = hostSkyPreambleDecls(repoRoot);
  const hostSets = new Set(preamble.map((d) => d.name));
  const hostType = new Map(preamble.map((d) => [d.name, d.type]));
  const out: PackLintViolation[] = [];
  const declared = new Set<string>(hostSets);
  for (const sky of input.skies) {
    const own = glslUniformDecls(sky.glsl);
    for (const d of own) declared.add(d.name);
    const stageDecl = new Set([...hostSets, ...own.map((d) => d.name)]);
    const code = stripGlslComments(sky.glsl);
    if (!off.has("uniform-type-conflict")) {
      for (const d of own) {
        const host = hostType.get(d.name);
        if (host === undefined || host === d.type) continue;
        out.push({
          file: sky.repoRel, line: lineColAt(code, d.offset ?? 0).line, rule: "uniform-type-conflict", target: `fragment:${d.name}`,
          detail: `(pack ${input.packId}) declares uniform ${d.name} as ${d.type}, but the host sky preamble declares ${host} ${d.name}`,
        });
      }
    }
    for (const read of glslCustomReads(sky.glsl)) {
      const line = lineColAt(code, read.offset).line;
      if (!stageDecl.has(read.name)) {
        if (off.has("glsl-uniform-undeclared")) continue;
        out.push({
          file: sky.repoRel, line, rule: "glsl-uniform-undeclared", target: `fragment:${read.name}`,
          detail: `pack sky reads ${read.name}, which neither the sky nor the host preamble declares`,
        });
      } else if (!hostSets.has(read.name) && !off.has("glsl-uniform-unset")) {
        out.push({
          file: sky.repoRel, line, rule: "glsl-uniform-unset", target: `fragment:${read.name}`,
          detail: `pack sky declares ${read.name} but the host only sets ${[...hostSets].join(", ")}`,
        });
      }
    }
  }
  const manifest = input.manifest ? manifestVizUniforms(input.manifest.text, repoRoot) : null;
  for (const fe of input.frontend) {
    const lex = lexTs(fe.text);
    for (const hit of lex.masked.matchAll(/\bwriteUniform\s*\(\s*(?=["'])/g)) {
      const lit = lex.strings.find((s) => s.start === hit.index! + hit[0].length);
      if (!lit || lit.kind !== "quote") continue;
      const line = lineColAt(fe.text, lit.start).line;
      if (manifest && !off.has("write-uniform-not-in-manifest") && !manifest.uniforms.includes(lit.text)) {
        out.push({
          file: fe.repoRel, line, rule: "write-uniform-not-in-manifest", target: lit.text,
          detail: manifest.source === "no-viz"
            ? `pack ${input.packId} calls writeUniform("${lit.text}"), but ${input.manifest!.repoRel} has no viz contract (graphWalk: false + idle), so the host drops it`
            : `pack ${input.packId} calls writeUniform("${lit.text}"), but ${input.manifest!.repoRel} viz.uniforms `
              + `${manifest.source === "list" ? `lists only [${manifest.uniforms.join(", ")}]` : "defaults exclude it"}, so the host drops the write`,
        });
      }
      if (off.has("uniform-set-undeclared")) continue;
      if (input.skies.length > 0 && declared.has(lit.text)) continue;
      out.push({
        file: fe.repoRel, line, rule: "uniform-set-undeclared", target: lit.text,
        detail: input.skies.length === 0
          ? `writeUniform("${lit.text}") but the pack ships no sky/*.glsl to bind it to`
          : `writeUniform("${lit.text}") but neither sky/*.glsl nor the host preamble declares it`,
      });
    }
  }
  return sortViolations(dedupe(out));
}

// ---------------------------------------------------------------------------
// Tree scan.

function walkFiles(dirAbs: string, keep: (rel: string) => boolean, rel = ""): string[] {
  const out: string[] = [];
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(path.join(dirAbs, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const sub = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      out.push(...walkFiles(dirAbs, keep, sub));
    } else if (e.isFile() && keep(sub)) out.push(sub);
  }
  return out.sort();
}

const isLintedTs = (rel: string) => rel.endsWith(".ts") && !rel.endsWith(".d.ts") && !/\.test\.ts$/.test(rel);

/** Read a pack directory into a {@link PackSkyInput}. */
export function readPackSkyInput(packDirAbs: string, repoPrefix: string, packId: string): PackSkyInput {
  const skies = walkFiles(path.join(packDirAbs, "sky"), (r) => r.endsWith(".glsl")).map((r) => ({
    repoRel: `${repoPrefix}/sky/${r}`,
    glsl: fs.readFileSync(path.join(packDirAbs, "sky", r), "utf8"),
  }));
  const frontend = walkFiles(path.join(packDirAbs, "frontend"), isLintedTs).map((r) => ({
    repoRel: `${repoPrefix}/frontend/${r}`,
    text: fs.readFileSync(path.join(packDirAbs, "frontend", r), "utf8"),
  }));
  const ymlAbs = path.join(packDirAbs, "plugin.yml");
  const manifest = fs.existsSync(ymlAbs) ? { repoRel: `${repoPrefix}/plugin.yml`, text: fs.readFileSync(ymlAbs, "utf8") } : null;
  return { packId, skies, frontend, manifest };
}

/** Uniform lint over `web/src` and every `plugins/src/<pack>`. */
export function scanUniformDeclarations(repoRoot: string, opts: UniformLintOptions = {}): PackLintViolation[] {
  const out: PackLintViolation[] = [];
  const ctx = defaultCtx(repoRoot);
  for (const rel of walkFiles(path.join(repoRoot, "web/src"), isLintedTs)) {
    const repoRel = `web/src/${rel}`;
    out.push(...lintTsFile(ctx, path.join(repoRoot, repoRel), repoRel, opts));
  }
  const packsRoot = path.join(repoRoot, "plugins/src");
  for (const packId of fs.readdirSync(packsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const prefix = `plugins/src/${packId}`;
    const input = readPackSkyInput(path.join(packsRoot, packId), prefix, packId);
    for (const fe of input.frontend) out.push(...lintTsFile(ctx, path.join(repoRoot, fe.repoRel), fe.repoRel, opts));
    out.push(...lintPackUniforms(input, repoRoot, opts));
  }
  return sortViolations(out);
}
