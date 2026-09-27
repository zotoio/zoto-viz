import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sdkPath = join(dirname(fileURLToPath(import.meta.url)), "../../../plugins/sdk/plugin-sandbox.ts");

describe("plugin sandbox sdk types", () => {
  it("ships ZotoVizPluginHost for pack authors", () => {
    expect.hasAssertions();
    const src = readFileSync(sdkPath, "utf8");
    expect(src).toMatch(/export interface ZotoVizPluginHost</);
  });
});
