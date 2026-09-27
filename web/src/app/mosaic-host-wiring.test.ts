import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { lookForMode } from "../plugins/plugin";
import {
  agentPatchTilesWhenViewOffWall,
  modeIdForMosaicPluginChange,
  mosaicFocusSlotForMode,
  mosaicModeAlreadyOnWall,
  mosaicPanePickFocusSlot,
  mosaicPluginSkyPaneView,
  shouldTickVizHudForFeed,
} from "./mosaic-host-wiring";

describe("mosaic host wiring", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("modeIdForMosaicPluginChange strips duplicate tile slot suffix", () => {
    expect(modeIdForMosaicPluginChange("plugin:topology!2")).toBe("plugin:topology");
  });

  it("mosaicPanePickFocusSlot focuses the slot that already shows the view id", () => {
    const tiles = ["plugin:b", "plugin:a!1"];
    expect(mosaicPanePickFocusSlot(tiles, "plugin:a", "plugin:b")).toBe("plugin:a!1");
  });

  it("mosaicFocusSlotForMode picks the duplicate slot carrying the mode id", () => {
    const tiles = ["plugin:y", "plugin:x!1"];
    expect(mosaicFocusSlotForMode(tiles, "plugin:x", "plugin:y")).toBe("plugin:x!1");
  });

  it("mosaicModeAlreadyOnWall treats duplicate pack slots as on-wall", () => {
    expect(mosaicModeAlreadyOnWall(["plugin:pack!1", "plugin:other"], "plugin:pack")).toBe(true);
    expect(mosaicModeAlreadyOnWall(["plugin:pack!1", "plugin:other"], "plugin:missing")).toBe(false);
  });

  it("agentPatchTilesWhenViewOffWall rewrites focused tile when view is not placed", () => {
    const next = agentPatchTilesWhenViewOffWall(["plugin:a", "plugin:b"], "plugin:b", "plugin:c");
    expect(next).toEqual(["plugin:a", "plugin:c"]);
  });

  it("agentPatchTilesWhenViewOffWall skips when duplicate slot already shows the view", () => {
    expect(agentPatchTilesWhenViewOffWall(["plugin:a!1", "plugin:b"], "plugin:a!1", "plugin:a")).toBeNull();
  });

  it("shouldTickVizHudForFeed is false while mosaic is on", () => {
    expect(shouldTickVizHudForFeed(true)).toBe(false);
    expect(shouldTickVizHudForFeed(false)).toBe(true);
  });

  it("mosaicPluginSkyPaneView strips slot suffix before sky lookup", () => {
    expect(mosaicPluginSkyPaneView("plugin:topology!2", "plugin", lookForMode).viewId).toBe("plugin:topology");
  });
});
