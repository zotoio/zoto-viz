import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "main.ts"),
  "utf8",
);

describe("main.ts plugin wiring", () => {
  it("calls syncMosaicPluginCaptions from syncMosaicPluginHudCaptions", () => {
    expect(mainSrc).toMatch(/function syncMosaicPluginHudCaptions\(\)[\s\S]*?syncMosaicPluginCaptions\(/);
  });

  it("resets SandboxConfigBatcher before attachPluginFrontend", () => {
    expect(mainSrc).toMatch(/sandboxConfigBatcher\.reset\(\)[\s\S]*?attachPluginFrontend/);
  });

  it("exports plugin opts through pluginOptsFromSpec", () => {
    expect(mainSrc).toContain("pluginOptsFromSpec(m, spec)");
  });
});
