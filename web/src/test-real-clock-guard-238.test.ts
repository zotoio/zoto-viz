// @vitest-environment node
/**
 * #238: test files don't read the real clock. A test file that never turns on vitest's fake timers may
 * not call the performance or Date `now` function: its rows would then depend on when and how fast the box
 * runs them. Fake-timer files are exempt (there those reads return the fake clock).
 *
 * Scope: the test files the #192 cast scanner walks (web/test-support/test-cast-scan.ts: *.test.ts[x]
 * and __tests__/ under its roots). Calls are found in code only (strings and comments blanked by the
 * same splitter). A mention inside a string or comment (e.g. a source-text check that asserts some
 * source no longer contains the call) is still flagged unless the file is on MENTION_ALLOWLIST below
 * with its exact count and a reason. The patterns are built so this file's own source holds none.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAST_SCAN_ROOTS, isScannedFile, splitCodeAndComments } from "../test-support/test-cast-scan";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CLOCK_READ = new RegExp(String.raw`\b(?:performance|Date)\s*\.\s*now\s*\(`, "g");
const FAKE_TIMERS = new RegExp(String.raw`\bvi\s*\.\s*useFakeTimers\s*\(`);

/** String or comment mentions allowed, per file, at an exact count. Keep it narrow: file + count + reason. */
const MENTION_ALLOWLIST: ReadonlyArray<{ file: string; mentions: number; reason: string }> = [
  {
    file: "web/src/plugins/typesafe-host-clock-wire.test.ts",
    mentions: 1,
    reason: "source-text check: asserts typesafe-host.ts no longer builds its timestamps from the Date clock",
  },
];

type ClockScan = { fakeTimers: boolean; calls: number[]; mentions: number[] };

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

/** Lines (1-based) of real-clock calls in code, and of mentions inside strings or comments. */
function scanClockReads(src: string): ClockScan {
  const { code } = splitCodeAndComments(src);
  const calls = [...code.matchAll(CLOCK_READ)].map((m) => lineOf(code, m.index));
  const remaining = [...calls];
  const mentions: number[] = [];
  for (const m of src.matchAll(CLOCK_READ)) {
    const line = lineOf(src, m.index);
    const at = remaining.indexOf(line);
    if (at >= 0) remaining.splice(at, 1);
    else mentions.push(line);
  }
  return { fakeTimers: FAKE_TIMERS.test(code), calls, mentions };
}

const isTestFile = (rel: string): boolean =>
  isScannedFile(rel) && (/\.test\.tsx?$/.test(rel) || /(^|\/)__tests__\//.test(rel));

function walk(dir: string, acc: string[]): string[] {
  let entries;
  try {
    entries = readdirSync(path.join(repoRoot, dir), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, acc);
    else if (entry.isFile() && isTestFile(rel)) acc.push(rel);
  }
  return acc;
}

const testFiles = CAST_SCAN_ROOTS.flatMap((root) => walk(root, [])).sort();
const scans = new Map(testFiles.map((rel) => [rel, scanClockReads(readFileSync(path.join(repoRoot, rel), "utf8"))]));

// Fixture text is assembled so this file holds no clock call or fake-timer call of its own.
const read = (clock: "performance" | "Date") => `${clock}.now()`;
const fakeTimersCall = "vi." + "useFakeTimers()";

describe("#238 real-clock guard", () => {
  it("scans the real test tree (the three files #238 named among them)", () => {
    expect(testFiles.length).toBeGreaterThan(400);
    for (const rel of [
      "web/src/plugins/tile-health-readback-count.test.ts",
      "web/src/plugins/pack-lint.test.ts",
      "web/src/plugins/pack-lint-uniforms.test.ts",
      "web/src/test-real-clock-guard-238.test.ts",
    ]) expect(testFiles).toContain(rel);
  });

  it("no test file without fake timers calls the real clock", () => {
    const offenders = [...scans]
      .filter(([, s]) => !s.fakeTimers && s.calls.length > 0)
      .flatMap(([rel, s]) => s.calls.map((line) => `${rel}:${line}`));
    expect(offenders).toEqual([]);
  });

  it("outside fake-timer files, clock mentions in strings or comments are only the allowlisted ones, at their count", () => {
    const allowed = new Map(MENTION_ALLOWLIST.map((a) => [a.file, a.mentions]));
    const unexpected = [...scans]
      .filter(([rel, s]) => !s.fakeTimers && s.mentions.length !== (allowed.get(rel) ?? 0))
      .map(([rel, s]) => `${rel}: ${s.mentions.length} mention(s) at ${s.mentions.join(", ")}, allowlisted ${allowed.get(rel) ?? 0}`);
    expect(unexpected).toEqual([]);
  });

  it("every allowlist entry is live: a scanned test file, no fake timers, no calls, a reason", () => {
    for (const a of MENTION_ALLOWLIST) {
      const s = scans.get(a.file);
      expect(s, a.file).toBeDefined();
      expect(s?.fakeTimers, a.file).toBe(false);
      expect(s?.calls, a.file).toEqual([]);
      expect(s?.mentions.length, a.file).toBe(a.mentions);
      expect(a.reason.length, a.file).toBeGreaterThan(20);
    }
  });

  it("the scanner tells calls from mentions, and only a fake-timer call in code exempts a file", () => {
    const src = [
      `const a = ${read("performance")} + 1;`,
      `const s = "${read("Date")}";`,
      `// ${read("performance")} in a comment`,
      "const t = `${" + read("Date") + "}`;",
    ].join("\n");
    expect(scanClockReads(src)).toEqual({ fakeTimers: false, calls: [1, 4], mentions: [2, 3] });
    expect(scanClockReads(`${fakeTimersCall};\n${src}`).fakeTimers).toBe(true);
    expect(scanClockReads(`const f = "${fakeTimersCall}";\n${src}`).fakeTimers).toBe(false);
    expect(scanClockReads(`// ${fakeTimersCall}\n${src}`).fakeTimers).toBe(false);
  });
});
