import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  formatViolation,
  lintProductionTree,
  lintSourceText,
} from "../../scripts/lint-brand-casts-core.mjs";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runLint(): { ok: true } | { ok: false; stderr: string } {
  try {
    execFileSync("pnpm", ["lint"], { cwd: webRoot, stdio: "pipe" });
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; stdout?: Buffer };
    const stderr = `${err.stderr?.toString() ?? ""}${err.stdout?.toString() ?? ""}`;
    return { ok: false, stderr };
  }
}

function stderrViolations(stderr: string): string[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(">") && line.includes(":"));
}

describe("lint brand casts", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("passes on the production tree", () => {
    const violations = lintProductionTree(webRoot).map(formatViolation);
    expect(violations).toEqual([]);
    const result = runLint();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect(stderrViolations(result.stderr)).toEqual([]);
    }
  });

  it("lint gate: no stray devicePixelRatio reads in production", () => {
    const sampleFile = "src/_lint-sample/stray-dpr.ts";
    const sample = "export const strayRead = devicePixelRatio;\n";
    expect(lintSourceText(sampleFile, sample).map(formatViolation)).toEqual([
      `${sampleFile}:device-px-ratio-read`,
    ]);
  });

  it("lint gate: brand casts only in mint modules", () => {
    const sampleFile = "src/_lint-sample/brand-cast.ts";
    const sample = "export const r = null as DeviceRect;\n";
    expect(lintSourceText(sampleFile, sample).map(formatViolation)).toEqual([
      `${sampleFile}:brand-cast`,
    ]);
  });
});
