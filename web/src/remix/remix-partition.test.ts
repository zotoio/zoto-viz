import { describe, expect, it } from "vitest";
import type { PluginView } from "../plugins/plugin";
import { applyPluginCatalog } from "../plugins/plugin";

const dataSource: PluginView = {
  id: "public-hn-top",
  name: "HN top",
  version: 1,
  pluginKind: "data-source",
  dataSource: {
    sources: [{
      id: "top",
      hosts: ["hnrss.org"],
      refreshSec: 300,
      apiKeyRequired: false,
      outputShape: "headlines",
      demoSnapshot: "snapshots/top.demo.json",
    }],
  },
};

const vizPack: PluginView = {
  id: "kefrens-bars",
  name: "Kefrens",
  version: 1,
  engine: "graph",
  capabilities: ["viz.read"],
};

describe("remix partition catalog", () => {
  it("applyPluginCatalog does not add data-source plugins to the view menu", () => {
    const modes = applyPluginCatalog([dataSource, vizPack]);
    expect(modes.some((m) => m.pluginId === "public-hn-top")).toBe(false);
    expect(modes.some((m) => m.pluginId === "kefrens-bars")).toBe(true);
  });
});
