import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  rejectPatchedVitestGreen,
  validatePatchProductionReachable,
  validatePatchTouchesOnlyProduction,
} from "./revert-proof-lib.mjs";

beforeEach(() => {
  expect.hasAssertions();
});

function thrownMessage(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}

describe("revert-proof dogfood guards", () => {
  it("stays-green guard rejects patched green vitest runs", () => {
    expect(thrownMessage(() => rejectPatchedVitestGreen("green", "dogfood"))).toBe(
      "row dogfood: test stayed GREEN after revert patch (expected failure)",
    );
  });

  it("production-only guard rejects patches touching test files", () => {
    expect(
      thrownMessage(() =>
        validatePatchTouchesOnlyProduction(
          "--- a/tests/foo.py\n+++ b/tests/foo.py\n",
          "dogfood",
        ),
      ),
    ).toBe("row dogfood: patch touches test files (only production reverts allowed)");
  });

  it("production reach guard rejects unreachable revert targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-reach-dog-"));
    try {
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(root, "web", "src"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "web", "src", "test-only-helper.ts"),
        "export const x = 1;\n",
      );
      fs.writeFileSync(
        path.join(root, "scripts", "revert-proof-production.json"),
        JSON.stringify({
          scanRoots: ["web/src"],
          entryPoints: ["web/src/app/main.ts"],
        }),
      );
      const patch = `--- a/web/src/test-only-helper.ts
+++ b/web/src/test-only-helper.ts
@@ -1 +1 @@
-export const x = 1;
+export const x = 2;
`;
      expect(thrownMessage(() => validatePatchProductionReachable(patch, "dogfood", root))).toBe(
        "row dogfood: revert target unreachable from production: web/src/test-only-helper.ts",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
