import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VIZ_FIXTURES, VIZ_FIXTURE_NAMES } from "../../../../plugins/sdk/viz-fixtures";
import { VIZ_SDK_FIXTURE_BUILDERS, type VizSdkFixtureName } from "./viz-sdk-frame-build";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const jsonDir = path.join(repoRoot, "plugins/sdk/fixtures");

describe("viz sdk frozen fixtures", () => {
  for (const name of VIZ_FIXTURE_NAMES) {
    it(`rebuilds ${name} from host code`, () => {
      const built = VIZ_SDK_FIXTURE_BUILDERS[name as VizSdkFixtureName]();
      const frozen = JSON.parse(readFileSync(path.join(jsonDir, `${name}.json`), "utf8"));
      expect(built).toEqual(frozen);
      expect(VIZ_FIXTURES[name]).toEqual(frozen);
    });
  }

  it("golden-live-failed exposes high sys.failed from units alias", () => {
    expect(VIZ_FIXTURES["golden-live-failed"].sys?.failed).toBeGreaterThan(0.5);
    expect(VIZ_FIXTURES["golden-live"].sys?.failed ?? 0).toBeLessThanOrEqual(0.5);
  });
});
