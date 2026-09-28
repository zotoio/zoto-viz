import { describe, expect, it } from "vitest";
import type { PluginView } from "../plugins/plugin";
import { partitionCatalog } from "../plugins/plugin-visualisation";

const dataSource: PluginView = {
  id: "public-hn-top",
  name: "HN top",
  version: 1,
  engine: "graph",
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
  it("partitionCatalog skips data-source plugins", () => {
    const { rows } = partitionCatalog([dataSource, vizPack]);
    expect(rows.some((r) => r.id === "public-hn-top")).toBe(false);
    expect(rows.some((r) => r.id === "kefrens-bars")).toBe(true);
  });
});
