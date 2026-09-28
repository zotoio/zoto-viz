import { describe, expect, it } from "vitest";
import { parseCatalogAssets, parseConfig, toPluginView } from "./plugin-visualisation";

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

describe("catalog assets", () => {
  it("keeps host-mesh GLB rows on the plugin view", () => {
    expect(parseCatalogAssets([
      { id: "fish-clownfish", path: "assets/fish-clownfish.glb", sha256: "abc", bytes: 12 },
      { id: "", path: "nope.glb" },
    ])).toEqual([{ id: "fish-clownfish", path: "assets/fish-clownfish.glb", sha256: "abc", bytes: 12 }]);
    const view = toPluginView({
      id: "aquarium",
      name: "Aquarium",
      version: 1,
      engine: "graph",
      assets: [{ id: "fish-betta", path: "assets/fish-betta.glb" }],
    });
    expect(view.assets?.map((a) => a.id)).toEqual(["fish-betta"]);
  });
});
