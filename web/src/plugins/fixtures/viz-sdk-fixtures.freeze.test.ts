import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { VIZ_SDK_FIXTURE_BUILDERS, type VizSdkFixtureName } from "./viz-sdk-frame-build";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const outDir = path.join(repoRoot, "plugins/sdk/fixtures");

describe("freeze viz sdk fixtures", () => {
  it.skipIf(!process.env.FREEZE_VIZ_FIXTURES)("write plugins/sdk/fixtures/*.json", () => {
    mkdirSync(outDir, { recursive: true });
    for (const name of Object.keys(VIZ_SDK_FIXTURE_BUILDERS) as VizSdkFixtureName[]) {
      const frame = VIZ_SDK_FIXTURE_BUILDERS[name]();
      writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(frame, null, 2)}\n`);
    }
  });
});
