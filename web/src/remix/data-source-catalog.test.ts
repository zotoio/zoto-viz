import { describe, expect, it } from "vitest";
import type { PluginView } from "../plugins/plugin";
import { buildRemixPickerModel } from "./remix-picker";
import { listDataSourcePlugins, listRemixVisualPacks } from "./data-source-catalog";

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

describe("remix catalog helpers", () => {
  it("lists data-source plugins separately from viz packs", () => {
    const specs = [dataSource, vizPack];
    expect(listDataSourcePlugins(specs)).toHaveLength(1);
    expect(listRemixVisualPacks(specs)).toHaveLength(1);
    expect(listRemixVisualPacks(specs)[0]?.id).toBe("kefrens-bars");
  });

  it("buildRemixPickerModel exposes both sides", () => {
    const model = buildRemixPickerModel([dataSource, vizPack]);
    expect(model.dataPlugins[0]?.id).toBe("public-hn-top");
    expect(model.visualPacks[0]?.id).toBe("kefrens-bars");
  });
});
