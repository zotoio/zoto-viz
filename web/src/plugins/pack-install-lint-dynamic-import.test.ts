/**
 * #194: a `frontend.bundle: false` pack is served as is, so nothing (no esbuild, no resolver) can see
 * what a non-literal `import()` in its scripts loads. The install lint refuses such a pack with the
 * block reason `dynamic_import_nonliteral` instead of skipping the call; a plain string literal
 * (checked by #186's in-process boundary resolver) still installs, and bundled packs are unchanged
 * (esbuild bundles them, and the install lint's bundled path never had this check).
 *
 * Every install row runs the real web/scripts/bundle-pack-entry.mjs (so the committed built lint,
 * pack-install-lint.built.mjs) on a temp copy of a shipped pack, the way the service does.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { scanHostLintFixture } from "../../../plugins/sdk/pack-lint";
import { PACK_LINT_PLAIN_SUMMARY } from "../../../plugins/sdk/pack-lint-hints";
import { extractModuleSpecifiers, extractPackImports } from "../../../plugins/sdk/pack-lint-import";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REASON = "dynamic_import_nonliteral";
const UNBUNDLED = "sandbox-fixture-multi";
const EXIT_LINT_BLOCK = 1;
/** The block sentence: pack lint's plain summary for a non-literal import (copy owned by UX Pro). */
const PLAIN = PACK_LINT_PLAIN_SUMMARY["unverified-import-call"];

const tmpRoots: string[] = [];
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

/** A temp copy of shipped pack `id`, with `code` appended to `file` (and `./a.js` next to it). */
function packWith(id: string, file: string, code: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "zv194-"));
  tmpRoots.push(root);
  const home = path.join(root, id);
  cpSync(path.join(repoRoot, "plugins/src", id), home, { recursive: true });
  writeFileSync(path.join(home, "frontend/a.js"), "export const a = 1;\n");
  appendFileSync(path.join(home, file), `\n${code}\n`);
  return home;
}

type Run = SpawnSyncReturns<string> & { nonce: string };

/** bundle-pack-entry.mjs on `home` with the install lint on (the service's argv and env). */
function install(home: string, opts: { lintOnly: boolean }): Run {
  const nonce = randomUUID();
  const script = path.join(repoRoot, "web/scripts/bundle-pack-entry.mjs");
  const argv = opts.lintOnly
    ? [script, "--lint-only", home, repoRoot]
    : [script, path.join(home, "frontend/index.ts"), path.join(repoRoot, "plugins/sdk"), home, repoRoot];
  const r = spawnSync(process.execPath, argv, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ZOTO_PACK_INSTALL_LINT: "1", ZOTO_PACK_INSTALL_LINT_NONCE: nonce, NODE_ENV: "production" },
    timeout: 60_000,
  });
  return Object.assign(r, { nonce });
}

function lines(text: string, type: string): Record<string, unknown>[] {
  return text.split(/\r?\n/).flatMap((l) => {
    try {
      const raw = JSON.parse(l.trim()) as Record<string, unknown>;
      return raw && raw.type === type ? [raw] : [];
    } catch {
      return [];
    }
  });
}

const why = (r: SpawnSyncReturns<string>) => `exit ${r.status} signal ${r.signal}; stderr: ${r.stderr.slice(0, 900)}`;

function expectPass(r: Run, pack: string): void {
  expect(r.status, why(r)).toBe(0);
  expect(lines(r.stderr, "pack-install-lint-block"), why(r)).toEqual([]);
  expect(lines(r.stderr, "pack-bundle-boundary"), why(r)).toEqual([]);
  expect(lines(r.stderr, "pack-install-lint-pass"), why(r)).toEqual([{ type: "pack-install-lint-pass", nonce: r.nonce, pack }]);
}

const REFUSED = [
  { row: "template literal import(`./${x}.js`)", code: "export const loadT = (x) => import(`./${x}.js`);", raw: "import(`…${…}`)" },
  { row: "variable import(name)", code: "export const loadV = (name) => import(name);", raw: "import(name)" },
  { row: "concatenation import('./a' + b)", code: "export const loadC = (b) => import('./a' + b);", raw: "import('./a' + b)" },
] as const;

describe("#194 an unbundled pack's non-literal import() is refused (dynamic_import_nonliteral)", () => {
  for (const { row, code, raw } of REFUSED) {
    it(`refused: ${row}`, () => {
      const r = install(packWith(UNBUNDLED, "frontend/helper.js", code), { lintOnly: true });
      expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
      const block = lines(r.stderr, "pack-install-lint-block");
      expect(block, why(r)).toHaveLength(1);
      expect(block[0]!.reason).toBe(REASON);
      expect(block[0]!.message).toBe(PLAIN);
      expect(block[0]!.details).toEqual([`frontend/helper.js:5 ${REASON} — ${raw}`]);
      expect(lines(r.stderr, "pack-install-lint-pass")).toEqual([]);
      expect(lines(r.stderr, "pack-bundle-boundary")).toEqual([]);
    }, 60_000);
  }

  it("the log line's :line is the original source line, even under a multi-line block comment", () => {
    const code = [
      "/*",
      " * A multi-line block comment above the call: masking blanks it but keeps its newlines,",
      " * so import(notThisOne) in here is ignored and the line below is still counted right.",
      " */",
      "export const loadV = (name) => import(name);",
    ].join("\n");
    const home = packWith(UNBUNDLED, "frontend/helper.js", code);
    const source = readFileSync(`${home}/frontend/helper.js`, "utf8");
    const trueLine = source.slice(0, source.indexOf("import(name)")).split("\n").length;
    expect(trueLine, "the fixture's call sits below the 4-line comment").toBe(9);
    const r = install(home, { lintOnly: true });
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    const block = lines(r.stderr, "pack-install-lint-block");
    expect(block, why(r)).toHaveLength(1);
    expect(block[0]!.reason).toBe(REASON);
    expect(block[0]!.details).toEqual([`frontend/helper.js:${trueLine} ${REASON} — import(name)`]);
  }, 60_000);

  it("allowed: plain string literal import('./a.js')", () => {
    expectPass(install(packWith(UNBUNDLED, "frontend/helper.js", "export const loadL = () => import('./a.js');"), { lintOnly: true }), UNBUNDLED);
  }, 60_000);

  it("allowed: template literal without substitutions import(`./a.js`) (a literal: nothing to resolve at runtime)", () => {
    expectPass(install(packWith(UNBUNDLED, "frontend/helper.js", "export const loadN = () => import(`./a.js`);"), { lintOnly: true }), UNBUNDLED);
  }, 60_000);

  it("a literal import() that leaves the pack is still the #186 boundary refusal, not this one", () => {
    const r = install(packWith(UNBUNDLED, "frontend/helper.js", "export const out = () => import('../../outside.js');"), { lintOnly: true });
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    expect(lines(r.stderr, "pack-bundle-boundary")[0], why(r)).toMatchObject({ file: "frontend/helper.js", import: "../../outside.js" });
    expect(lines(r.stderr, "pack-install-lint-block")).toEqual([]);
  }, 60_000);

  it("bundled packs are unaffected: import(name) in a bundled pack's .ts still installs", () => {
    const home = packWith("star-sines", "frontend/index.ts", "export const loadB = (name: string) => import(name);");
    expectPass(install(home, { lintOnly: false }), "star-sines");
  }, 60_000);
});

describe("#194 the import extractor: a literal is only the whole argument when `)` or `,` follows it", () => {
  it("'./a' + b and `./a` + b are unverified; literals with attributes stay literal", () => {
    const sites = (src: string) => extractPackImports(src).map((s) => (s.kind === "unverified" ? `unverified ${s.raw}` : `${s.kind} ${s.specifier}`));
    expect(sites("import('./a' + b);")).toEqual(["unverified import('./a' + b)"]);
    expect(sites("import(`./a` + b);")).toEqual(["unverified import(`./a` + b)"]);
    expect(sites("import( './a.js' );")).toEqual(["dynamic ./a.js"]);
    expect(sites("import('./a.json', { with: { type: 'json' } });")).toEqual(["dynamic ./a.json"]);
    expect(sites("import(`./a.js`);")).toEqual(["dynamic ./a.js"]);
  });

  it("hostSpec pin: the host reverse-boundary scan still sees ./a for import('./a' + b) (kind unverified)", () => {
    const [site] = extractPackImports("import('./a' + b);");
    expect(site).toMatchObject({ kind: "unverified", call: "import", hostSpec: "./a" });
    expect(extractPackImports("import(`./a` + b);")[0]).toMatchObject({ kind: "unverified", call: "import", hostSpec: "./a" });
    // The host scan's own extraction, and a real host file concatenating onto a pack source path.
    expect(extractModuleSpecifiers("import('./a' + b);")).toEqual(["./a"]);
    const hits = scanHostLintFixture(
      "web/src/plugins/host-concat-fixture.ts",
      'export const load = (ext: string) => import("../../../plugins/src/marble-run/frontend/config" + ext);\n',
      repoRoot,
    );
    expect(hits.map((h) => [h.rule, h.target])).toEqual([["host-imports-pack-src", "plugins/src/marble-run/frontend/config.ts"]]);
  });
});
