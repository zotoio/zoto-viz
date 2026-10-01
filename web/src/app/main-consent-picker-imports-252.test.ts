/**
 * #252: main-consent-picker.wiring.test.ts boots the app entry the way main.wiring.test.ts does
 * since #239: its page comes from the side-effect import of web/test-support/main-entry-env.ts,
 * then a static `import "./main"`, both while the file is collected. A cold `await import("./main")`
 * after `vi.resetModules()` in the setup hook spent that hook's limit on module loading, and the
 * file had raised its limits (hook, waitFor, row) to get past it. This row reads that file's
 * source, so it holds whatever the load on the box.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitCodeAndComments } from "../../test-support/test-cast-scan";

const source = readFileSync(resolve(__dirname, "main-consent-picker.wiring.test.ts"), "utf8");
/** The file's code with strings and comments blanked: a mention in prose is not a call. */
const code = splitCodeAndComments(source).code;

/** Specifiers of the file's top-level static imports, in order (`import x from "s"` and `import "s"`). */
const staticImports = [...source.matchAll(/^import\s+(?:[^"';]*?\s+from\s+)?(["'])([^"']+)\1\s*;?\s*$/gm)].map((m) => m[2]!);

describe("#252: main-consent-picker.wiring boots main.ts at collection, never inside a hook or a row", () => {
  it("imports main.ts statically after the page it boots into", () => {
    expect(code.match(/\bimport\s*\(/g) ?? []).toEqual([]);
    expect(staticImports).toContain("./main");
    expect(staticImports).toContain("../../test-support/main-entry-env");
    expect(staticImports.indexOf("../../test-support/main-entry-env")).toBeLessThan(staticImports.indexOf("./main"));
  });

  it("resets no modules and raises no limit: no resetModules, no timeout option, no hook or row limit argument", () => {
    expect(code.match(/\bresetModules\b/g) ?? []).toEqual([]);
    expect(code.match(/\btimeout\s*:/g) ?? []).toEqual([]);
    // `beforeEach(fn, 30_000)` / `it(name, fn, 20_000)`: a number right after a function's closing brace.
    expect(code.match(/\}\s*,\s*\d[\d_]*\s*\)/g) ?? []).toEqual([]);
  });
});
