// @vitest-environment node
/**
 * #192: web/tsconfig.test.json type-checks every test file by glob (web/src, plugins/src, plugins/sdk,
 * scripts/, web/scripts). Its `exclude` has two blocks:
 * - SHRINK-ONLY: test files that still have tsc errors. Each path must exist and must still have at
 *   least one tsc error, so a fixed file has to leave the list.
 * - HELD: scripts/revert-proof* is a held path (ask ZotoBoss). Those paths must exist and stay under
 *   scripts/revert-proof*, and are exempt from the shrink-only rule.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_CONFIG = path.join(webRoot, "tsconfig.test.json");
const TSC_BIN = path.join(webRoot, "node_modules/.bin/tsc");
const TSC_ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+/;

const HELD_MARKER = "// HELD";
const HELD_PREFIX = "../scripts/revert-proof";

type ExcludeBlocks = { shrinkOnly: string[]; held: string[] };

/**
 * Splits `exclude` at the `// HELD` comment line. tsconfig allows `//` comments; tsconfig.test.json
 * only uses whole-line ones, so the list is read line by line.
 */
function readExcludeBlocks(): ExcludeBlocks {
  const lines = readFileSync(TEST_CONFIG, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith('"exclude": ['));
  if (start < 0) throw new Error("tsconfig.test.json has no exclude list");
  const blocks: ExcludeBlocks = { shrinkOnly: [], held: [] };
  let inHeld = false;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith("]")) break;
    if (line.startsWith(HELD_MARKER)) inHeld = true;
    if (line.startsWith("//") || line === "") continue;
    const entry = /^"([^"]+)",?$/.exec(line);
    if (!entry) throw new Error(`unexpected exclude line: ${raw}`);
    (inHeld ? blocks.held : blocks.shrinkOnly).push(entry[1]);
  }
  return blocks;
}

/** `exclude` as tsc sees it (whole-line `//` comments dropped). */
function readExcludeJson(): string[] {
  const text = readFileSync(TEST_CONFIG, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return (JSON.parse(text) as { exclude: string[] }).exclude;
}

function tscOutput(err: unknown): string {
  const e = err as { stdout?: string; stderr?: string };
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
      });
    } catch (err) {
      out = tscOutput(err);
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

describe("tsconfig.test.json exclude list (#192)", () => {
  const { shrinkOnly, held } = readExcludeBlocks();

  it("each block lists sorted, unique test files", () => {
    for (const block of [shrinkOnly, held]) {
      expect(block.filter((p) => !p.endsWith(".test.ts"))).toEqual([]);
      expect(block).toEqual([...new Set(block)].sort());
    }
    expect(shrinkOnly.filter((p) => held.includes(p))).toEqual([]);
    expect([...shrinkOnly, ...held].sort()).toEqual([...readExcludeJson()].sort());
  });

  it("every excluded path exists (shrink-only and held)", () => {
    expect([...shrinkOnly, ...held].filter((p) => !existsSync(path.resolve(webRoot, p)))).toEqual([]);
  });

  it("the held block only names scripts/revert-proof* files", () => {
    expect(held.filter((p) => !p.startsWith(HELD_PREFIX))).toEqual([]);
  });

  it("every shrink-only path still has a tsc error (delete fixed files from the shrink-only block)", () => {
    const withErrors = testFilesWithTscErrors();
    expect(shrinkOnly.filter((p) => !withErrors.has(p))).toEqual([]);
  }, 180_000);
});
