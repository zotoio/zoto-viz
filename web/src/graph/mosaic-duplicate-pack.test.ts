import { describe, expect, it } from "vitest";
import { nextPaneTiles } from "./mosaic-layout";
import { mosaicTileViewId } from "./mosaic-tile-id";
import { mosaicPaneMode } from "./mosaic";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { setPluginModes } from "../core/modes";

describe("mosaic duplicate pack on second tile", () => {
  it("allocates a slot id instead of swapping when the view is already on the wall", () => {
    const view = "plugin:settings-fixture";
    const next = nextPaneTiles([view, "plugin:topology"], "plugin:topology", view);
    expect(next[1]).toBe("plugin:settings-fixture!1");
    expect(mosaicTileViewId(next[1]!)).toBe(view);
  });

  it("resolves mosaic pane mode for slot suffix ids", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] })]);
    const mode = mosaicPaneMode("plugin:settings-fixture!2");
    expect(mode.id).toBe("plugin:settings-fixture!2");
    expect(mode.pluginId).toBe("settings-fixture");
  });
});
