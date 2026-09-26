import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..");

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkTsFiles(path, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Wall notices must use core/wall-notice-region only — no graph/wall-notice stub. */
describe("wall notice modules", () => {
  it("web/src contains exactly one wall-notice module", () => {
    const modules = walkTsFiles(SRC_ROOT).filter((p) => /[/\\]wall-notice(-region)?\.ts$/.test(p));
    expect(modules).toEqual([join(SRC_ROOT, "core", "wall-notice-region.ts")]);
    expect(modules).not.toContain(join(SRC_ROOT, "graph", "wall-notice.ts"));
  });
});
