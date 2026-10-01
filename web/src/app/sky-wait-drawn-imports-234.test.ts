/**
 * #234: sky-wait-drawn.test.ts loads the scene module (three.js and the whole render stack) when
 * the file is collected. A cold `await import("../graph/scene")` inside a row spends that row's own
 * limit on module loading, and the row ran over whenever other test files were loading in parallel.
 * This row reads that file's source, so it holds whatever the load on the box.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "sky-wait-drawn.test.ts"), "utf8");

/** Names in each top-level `import { ... } from "<spec>"` of the file. */
function staticImportNames(spec: string): string[] {
  const names: string[] = [];
  const re = /^import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2/gm;
  for (const m of source.matchAll(re)) {
    if (m[3] !== spec) continue;
    for (const part of m[1]!.split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("#234: sky-wait-drawn loads the render stack at collection, never inside a row", () => {
  it("sky-wait-drawn loads the render stack at collection, never inside a row", () => {
    const dynamic = [...source.matchAll(/\bimport\s*\(\s*(["'])(\.\.\/graph\/[^"']*|\.\.\/plugins\/pack-asset-pane-notice)\1\s*\)/g)]
      .map((m) => m[0]);
    expect(dynamic).toEqual([]);
    expect(staticImportNames("../graph/scene")).toContain("isOverlayControl");
    expect(staticImportNames("../plugins/pack-asset-pane-notice")).toContain("paintPackAssetPaneNotice");
  });
});
