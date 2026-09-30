// @vitest-environment node
/**
 * #192: web/tsconfig.test.json type-checks every test file by glob (web/src, plugins/src, plugins/sdk,
 * scripts/, web/scripts). Its `exclude` has two blocks:
 * - SHRINK-ONLY: test files that still have tsc errors. Each path must exist and must still have at
 *   least one tsc error, so a fixed file has to leave the list.
 * - HELD: scripts/revert-proof* is a held path (ask ZotoBoss). Those paths must exist and stay under
 *   scripts/revert-proof*, and are exempt from the shrink-only rule.
 *
 * The test-cast row: test code gets no new escape hatches: `as unknown as`, `as any`, `as never`,
 * `: any` annotations, `Object.create(` (returns `any`), or ts-ignore / ts-expect-error / ts-nocheck
 * comments. Scope and matching live in
 * web/test-support/test-cast-scan.ts (test files and __tests__ under web/src, web/scripts, plugins/src,
 * plugins/sdk; all of web/test, web/test-support, web/typecheck, web/assembly and scripts/; test
 * helpers under web/src). Code patterns count only outside strings and comments. Partial fakes go
 * through mockPartial() in web/test-support/mock-partial.ts, the only file exempt. Existing hits are
 * listed per file in tsconfig-test-casts.baseline.json, which may only shrink.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { testCastCounts } from "../test-support/test-cast-scan";

// One whole-program tsc run takes ~5-9 s on a loaded box; keep the default 5 s from flaking it.
vi.setConfig({ testTimeout: 120_000 });

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_CONFIG = path.join(webRoot, "tsconfig.test.json");
const TSC_BIN = path.join(webRoot, "node_modules/.bin/tsc");
const TSC_ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+/;
/** Below the 120 s test timeout, so a hung tsc fails with its own message. */
const TSC_TIMEOUT_MS = 90_000;

const HELD_MARKER = "// HELD";
const HELD_PREFIX = "../scripts/revert-proof";

type ExcludeBlocks = { shrinkOnly: string[]; held: string[] };

const TEST_CONFIG_REL = "web/tsconfig.test.json";
const TEST_FILE = /\.test\.tsx?$/;

/**
 * tsconfig.test.json as JSON (tsconfig allows `//` comments; this file only uses whole-line ones).
 * A file that doesn't parse fails every row with the parser's message, not with a list of paths.
 */
function readTestConfig(): { exclude: string[] } {
  // Blank the comment lines rather than drop them, so the parser's line numbers match the file.
  const text = readFileSync(TEST_CONFIG, "utf8")
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`could not parse ${TEST_CONFIG_REL}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const exclude = (parsed as { exclude?: unknown } | null)?.exclude;
  if (!Array.isArray(exclude) || !exclude.every((p) => typeof p === "string")) {
    throw new Error(`could not parse ${TEST_CONFIG_REL}: "exclude" is not a list of paths`);
  }
  return { exclude };
}

/** Splits `exclude` at the `// HELD` comment line (the list is read line by line to see the comments). */
function readExcludeBlocks(): ExcludeBlocks {
  readTestConfig();
  const lines = readFileSync(TEST_CONFIG, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith('"exclude": ['));
  if (start < 0) throw new Error(`could not parse ${TEST_CONFIG_REL}: no "exclude": [ line`);
  const blocks: ExcludeBlocks = { shrinkOnly: [], held: [] };
  let inHeld = false;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith("]")) break;
    if (line.startsWith(HELD_MARKER)) inHeld = true;
    if (line.startsWith("//") || line === "") continue;
    const entry = /^"([^"]+)",?$/.exec(line);
    if (!entry) throw new Error(`could not parse ${TEST_CONFIG_REL}: unexpected exclude line: ${raw}`);
    (inHeld ? blocks.held : blocks.shrinkOnly).push(entry[1]);
  }
  return blocks;
}

let blocksCache: ExcludeBlocks | undefined;
/** Read lazily inside each row, so a parse failure is reported by the rows themselves. */
function excludeBlocks(): ExcludeBlocks {
  blocksCache ??= readExcludeBlocks();
  return blocksCache;
}

type ExecError = { code?: string; signal?: string | null; status?: number | null; stdout?: string; stderr?: string };

/**
 * tsc exits non-zero (1 with tsc 7.0.2) when it reports errors; that output is the result. A timeout
 * or spawn failure is not.
 */
function tscOutput(err: unknown): string {
  const e = err as ExecError;
  if (e.code === "ETIMEDOUT" || e.signal) {
    throw new Error(`tsc did not finish within ${TSC_TIMEOUT_MS / 1000} s (killed with ${e.signal ?? "a signal"}); the exclude list was not checked`);
  }
  if (typeof e.status !== "number") throw new Error(`tsc could not be run: ${String(e.code ?? err)}`);
  return `${e.stdout ?? ""}${e.stderr ?? ""}`;
}

/** Web-relative test files with >= 1 tsc error when nothing is excluded (the tsgap metric's program). */
function testFilesWithTscErrors(): Set<string> {
  // Under web/ so `types` (node, vite/client, vitest/globals) resolve from web/node_modules.
  const cacheDir = path.join(webRoot, "node_modules/.cache");
  mkdirSync(cacheDir, { recursive: true });
  const dir = mkdtempSync(path.join(cacheDir, "tsgap-exclude-"));
  try {
    const cfg = path.join(dir, "tsconfig.all-tests.json");
    writeFileSync(cfg, JSON.stringify({ extends: TEST_CONFIG, exclude: [] }));
    let out: string;
    try {
      out = execFileSync(TSC_BIN, ["-p", cfg, "--noEmit", "--pretty", "false"], {
        cwd: webRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: TSC_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
    } catch (err) {
      out = tscOutput(err);
    }
    const configErrors = out.split("\n").filter((line) => /tsconfig[^/\\]*\.json\(\d+,\d+\): error TS/.test(line));
    if (configErrors.length > 0) {
      throw new Error(`could not parse ${TEST_CONFIG_REL} (tsc):\n${configErrors.join("\n")}`);
    }
    const files = new Set<string>();
    for (const line of out.split("\n")) {
      const m = TSC_ERROR_LINE.exec(line);
      if (m) files.add(path.relative(webRoot, path.resolve(webRoot, m[1])).split(path.sep).join("/"));
    }
    if (files.size === 0 && /error TS/.test(out)) throw new Error(`tsc failed without file errors:\n${out}`);
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const repoRoot = path.resolve(webRoot, "..");
const CAST_BASELINE = path.join(webRoot, "src/tsconfig-test-casts.baseline.json");

describe("tsconfig.test.json exclude list (#192)", () => {
  it("each block lists sorted, unique test files", () => {
    const { shrinkOnly, held } = excludeBlocks();
    for (const block of [shrinkOnly, held]) {
      expect(block.filter((p) => !TEST_FILE.test(p))).toEqual([]);
      expect(block).toEqual([...new Set(block)].sort());
    }
    expect(shrinkOnly.filter((p) => held.includes(p))).toEqual([]);
    expect([...shrinkOnly, ...held].sort()).toEqual([...readTestConfig().exclude].sort());
  });

  it("every excluded path exists (shrink-only and held)", () => {
    const { shrinkOnly, held } = excludeBlocks();
    expect([...shrinkOnly, ...held].filter((p) => !existsSync(path.resolve(webRoot, p)))).toEqual([]);
  });

  it("the held block only names scripts/revert-proof* files", () => {
    const { held } = excludeBlocks();
    expect(held.filter((p) => !p.startsWith(HELD_PREFIX))).toEqual([]);
  });

  it("every shrink-only path still has a tsc error (delete fixed files from the shrink-only block)", () => {
    const { shrinkOnly } = excludeBlocks();
    const withErrors = testFilesWithTscErrors();
    expect(shrinkOnly.filter((p) => !withErrors.has(p))).toEqual([]);
  });

  it("test code adds no casts outside mockPartial() and the shrink-only cast baseline", () => {
    const baseline = new Map(Object.entries(JSON.parse(readFileSync(CAST_BASELINE, "utf8")) as Record<string, number>));
    const counts = testCastCounts(repoRoot);
    const added = [...counts].filter(([rel, n]) => n > (baseline.get(rel) ?? 0)).map(([rel, n]) => `${rel}: ${n} (baseline ${baseline.get(rel) ?? 0}); use mockPartial() or a small fake`);
    expect(added).toEqual([]);
    const lower = [...baseline].filter(([rel, n]) => (counts.get(rel) ?? 0) < n).map(([rel, n]) => `${rel}: ${counts.get(rel) ?? 0} (baseline ${n}); lower its count in tsconfig-test-casts.baseline.json`);
    expect(lower).toEqual([]);
  });
});
