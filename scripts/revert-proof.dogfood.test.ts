import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  rejectPatchedVitestGreen,
  validatePatchProductionReachable,
  validatePatchTouchesOnlyProduction,
} from "./revert-proof.mjs";

describe("revert-proof dogfood guards", () => {
  it("stays-green guard rejects patched green vitest runs", () => {
    expect(() => rejectPatchedVitestGreen("green", "dogfood")).toThrow(
      /stayed GREEN/,
    );
  });

  it("production-only guard rejects patches touching test files", () => {
    expect(() =>
      validatePatchTouchesOnlyProduction(
        "--- a/tests/foo.py\n+++ b/tests/foo.py\n",
        "dogfood",
      ),
    ).toThrow(/test files/);
  });

  it("production reach guard rejects unreachable revert targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rp-reach-dog-"));
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
    expect(() => validatePatchProductionReachable(patch, "dogfood", root)).toThrow(
      /revert target unreachable from production: web\/src\/test-only-helper\.ts/,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});
