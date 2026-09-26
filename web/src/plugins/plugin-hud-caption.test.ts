import { describe, expect, it } from "vitest";
import { applyInstance } from "./instances";
import { buildPluginHudCaption } from "./plugin-settings";
import { loadSettingsDeclFixture } from "./fixtures/load-settings-fixture";
import { applyPresetToValues } from "./plugin-settings";

describe("per-tile HUD captions", () => {
  it("two instance tiles show different preset labels", () => {
    const base = {
      ...loadSettingsDeclFixture(),
      id: "settings-mosaic",
      instances: [{ id: "tile-a" }, { id: "tile-b" }],
    };
    const fields = base.config ?? [];
    const tileA = applyInstance(base, { id: "tile-a" });
    const tileB = applyInstance(base, { id: "tile-b" });
    const va: Record<string, string> = {};
    const vb: Record<string, string> = {};
    applyPresetToValues(tileA, fields, va, "a");
    applyPresetToValues(tileB, fields, vb, "b");
    expect(buildPluginHudCaption(tileA, fields, va)).toBe("X · Alpha");
    expect(buildPluginHudCaption(tileB, fields, vb)).toBe("Y · Bravo");
    expect(buildPluginHudCaption(tileA, fields, va)).not.toBe(buildPluginHudCaption(tileB, fields, vb));
  });
});
