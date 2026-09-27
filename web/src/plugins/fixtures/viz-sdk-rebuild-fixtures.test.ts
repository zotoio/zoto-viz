import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { VIZ_FIXTURE_NAMES } from "../../../../plugins/sdk/viz-fixtures";
import { VIZ_SDK_FIXTURE_BUILDERS } from "./viz-sdk-frame-build";

const jsonDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../plugins/sdk/fixtures",
);

describe("viz sdk fixture rebuild (manual)", () => {
  it("writes committed JSON from host builders", () => {
    if (process.env.VIZ_SDK_REBUILD_FIXTURES !== "1") return;
    for (const name of VIZ_FIXTURE_NAMES) {
      const built = VIZ_SDK_FIXTURE_BUILDERS[name]();
      writeFileSync(path.join(jsonDir, `${name}.json`), `${JSON.stringify(built, null, 2)}\n`);
    }
  });
});
