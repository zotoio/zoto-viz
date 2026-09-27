import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PluginField } from "./modes";

const modesPath = join(dirname(fileURLToPath(import.meta.url)), "modes.ts");

describe("PluginField typing", () => {
  it("allows config field section for settings grouping", () => {
    expect.hasAssertions();
    const field: PluginField = {
      key: "gain",
      label: "gain",
      type: "number",
      section: "Motion",
    };
    expect(field.section).toBe("Motion");
    const src = readFileSync(modesPath, "utf8");
    expect(src).toContain("section?: string");
  });
});
