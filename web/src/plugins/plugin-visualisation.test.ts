import { describe, expect, it } from "vitest";
import { parseConfig } from "./plugin-visualisation";

describe("parseConfig", () => {
  it("maps plugin.yml section onto PluginField", () => {
    expect.hasAssertions();
    const fields = parseConfig([
      { key: "gain", label: "gain", type: "number", default: 1, section: "Motion" },
      { key: "on", label: "on", type: "boolean", default: true },
    ]);
    expect(fields).toEqual([
      expect.objectContaining({ key: "gain", section: "Motion" }),
      expect.objectContaining({ key: "on" }),
    ]);
    expect(fields?.[1]?.section).toBeUndefined();
  });
});
