import { describe, expect, it } from "vitest";
import { encodeStoredConfigValue, fieldDefault, instanceDefaultValue, type PluginView } from "./plugin";
import { presetValueForField } from "./plugin-settings";

const BOOL_FIELD = { key: "fx", label: "fx", type: "boolean" as const, default: true };

describe("boolean config encoding", () => {
  it("uses 1/0 for field default, instance default, and preset value", () => {
    expect(fieldDefault(BOOL_FIELD)).toBe("1");
    expect(presetValueForField(BOOL_FIELD, false)).toBe("0");
    expect(presetValueForField(BOOL_FIELD, true)).toBe("1");

    const spec: PluginView = {
      id: "b",
      name: "B",
      version: 1,
      engine: "graph",
      config: [BOOL_FIELD],
      instanceDefaults: { fx: false },
    };
    expect(instanceDefaultValue(spec, "fx")).toBe("0");
    expect(encodeStoredConfigValue(BOOL_FIELD, false)).toBe("0");
    expect(encodeStoredConfigValue(BOOL_FIELD, "true")).toBe("1");
  });
});
