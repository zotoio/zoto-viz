/**
 * #239: main.wiring.test.ts boots the app entry (main.ts and everything it pulls in) when the file
 * is collected: its page (body, WebSocket stub, /api stubs) comes from the side-effect import of
 * web/test-support/main-entry-env.ts, then a static `import "./main"`. A cold `await import("./main")`
 * inside the setup hook spent that hook's whole limit on module loading, and the hook ran over
 * whenever other test files were loading in parallel. This row reads that file's source, so it holds
 * whatever the load on the box.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitCodeAndComments } from "../../test-support/test-cast-scan";

const source = readFileSync(resolve(__dirname, "main.wiring.test.ts"), "utf8");
/** The file's code with strings and comments blanked: a mention in prose is not an import. */
const code = splitCodeAndComments(source).code;

/** Specifiers of the file's top-level static imports, in order (`import x from "s"` and `import "s"`). */
const staticImports = [...source.matchAll(/^import\s+(?:[^"';]*?\s+from\s+)?(["'])([^"']+)\1\s*;?\s*$/gm)].map((m) => m[2]!);

describe("#239: main.wiring boots main.ts at collection, never inside a hook or a row", () => {
  it("has no dynamic import at all, and imports main.ts statically after the page it boots into", () => {
    expect(code.match(/\bimport\s*\(/g) ?? []).toEqual([]);
    expect(staticImports).toContain("./main");
    expect(staticImports).toContain("../../test-support/main-entry-env");
    expect(staticImports.indexOf("../../test-support/main-entry-env")).toBeLessThan(staticImports.indexOf("./main"));
  });
});
