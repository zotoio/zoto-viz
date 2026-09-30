import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const KOI_PACK_DIR = path.join(repoRoot, "plugins/src/koi-pond");
const KOI_FRONTEND_DIR = path.join(KOI_PACK_DIR, "frontend");
const KOI_PACK_TEST = path.join(KOI_FRONTEND_DIR, "index.test.ts");

/**
 * Pack lint is loaded by a runtime specifier so tsconfig.test.json does not pull plugins/sdk/pack-lint.ts
 * (and its pre-existing sdk type errors) into the test program; vitest loads the same module by absolute path.
 */
const PACK_LINT_MODULE = path.join(repoRoot, "plugins/sdk/pack-lint.ts");
type PackInstallLintFinding = { rule: string; target: string; file: string; line: number };
type PackInstallLint = (packDirAbs: string, repoRoot: string) => {
  blocks: PackInstallLintFinding[];
  warnings: PackInstallLintFinding[];
};
let scanPackInstallLint: PackInstallLint;
beforeAll(async () => {
  ({ scanPackInstallLint } = (await import(/* @vite-ignore */ PACK_LINT_MODULE)) as { scanPackInstallLint: PackInstallLint });
});

/** The pack test's guard on FRONT for the host page (`expect(FRONT).not.… parent … document …`). */
function koiParentDocumentGuardLine(): string {
  const lines = readFileSync(KOI_PACK_TEST, "utf8").split("\n");
  const hits = lines.filter((l) => /expect\(FRONT\)\.not\./.test(l) && /parent/.test(l) && /document/.test(l));
  expect(hits, "koi-pond index.test.ts has exactly one FRONT parent/document guard").toHaveLength(1);
  return hits[0]!;
}

/** The regex literal the koi pack test asserts FRONT does not match, or null when it is not a regex check. */
function koiParentDocumentGuardRegex(): RegExp | null {
  const m = /\.not\.toMatch\(\s*\/(.+)\/([a-z]*)\s*\)/.exec(koiParentDocumentGuardLine());
  return m ? new RegExp(m[1]!, m[2]) : null;
}

const INJECTED_EXACT = "const host = parent.document;";
const INJECTED_SPACED = [
  "const host = parent . document;",
  "const host = parent\n.document;",
  "const host = parent\n  .\n  document;",
  "const host = parent\t.document;",
];

describe("koi-pond sandbox rows (#187)", () => {
  it("pack install lint finds no sandbox-escape in koi-pond (#187)", () => {
    const { blocks } = scanPackInstallLint(KOI_PACK_DIR, repoRoot);
    expect(blocks.filter((v) => v.rule === "sandbox-escape")).toEqual([]);
  });

  it("koi pack test guards FRONT with the spacing-aware parent.document regex, not toContain (#187)", () => {
    const line = koiParentDocumentGuardLine();
    expect(line).not.toMatch(/toContain\(\s*["']parent\.document["']\s*\)/);
    const re = koiParentDocumentGuardRegex();
    expect(re, "guard is a not.toMatch(/…/) regex check").not.toBeNull();
    expect(re!.source).toBe(/\bparent\s*\.\s*document\b/.source);
  });

  it("the guard regex catches injected parent.document and the spacing variants toContain misses (#187)", () => {
    const re = koiParentDocumentGuardRegex();
    expect(re).not.toBeNull();
    // Half 1: the regex catches the exact form and every spacing variant.
    expect(re!.test(INJECTED_EXACT)).toBe(true);
    for (const src of INJECTED_SPACED) expect(re!.test(src), JSON.stringify(src)).toBe(true);
    // Half 2: a plain toContain("parent.document") catches the exact form but misses every spacing variant.
    expect(INJECTED_EXACT).toContain("parent.document");
    for (const src of INJECTED_SPACED) expect(src, JSON.stringify(src)).not.toContain("parent.document");
    // No false positive on words that merely end in "parent".
    expect(re!.test("const apparent.documentation = 1;")).toBe(false);
  });

  it("koi-pond frontend sources have no parent.document under the guard regex (#187)", () => {
    const re = koiParentDocumentGuardRegex() ?? /\bparent\s*\.\s*document\b/;
    const sources = readdirSync(KOI_FRONTEND_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources).toContain("index.ts");
    for (const f of sources) {
      expect(readFileSync(path.join(KOI_FRONTEND_DIR, f), "utf8"), f).not.toMatch(re);
    }
  });
});
