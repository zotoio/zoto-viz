import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runLint(): { ok: true } | { ok: false; stderr: string } {
  try {
    execFileSync("pnpm", ["lint"], { cwd: webRoot, stdio: "pipe" });
    return { ok: true };
  } catch (e: unknown) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
    return { ok: false, stderr };
  }
}

describe("lint brand casts", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("passes on the production tree", () => {
    const result = runLint();
    expect(result.ok).toBe(true);
  });

  it("lint gate: no stray devicePixelRatio reads in production", () => {
    const result = runLint();
    expect(result.ok).toBe(true);
  });

  it("lint gate: brand casts only in mint modules", () => {
    const result = runLint();
    expect(result.ok).toBe(true);
  });
});
