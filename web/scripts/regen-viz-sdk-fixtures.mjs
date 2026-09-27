import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { VIZ_FIXTURE_NAMES } = await import(path.join(root, "plugins/sdk/viz-fixtures.ts"));
const { VIZ_SDK_FIXTURE_BUILDERS } = await import(path.join(root, "web/src/plugins/fixtures/viz-sdk-frame-build.ts"));
const jsonDir = path.join(root, "plugins/sdk/fixtures");

for (const name of VIZ_FIXTURE_NAMES) {
  const built = VIZ_SDK_FIXTURE_BUILDERS[name]();
  writeFileSync(path.join(jsonDir, `${name}.json`), `${JSON.stringify(built, null, 2)}\n`);
  console.log("wrote", name);
}
