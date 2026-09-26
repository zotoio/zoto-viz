import { describe, expect, it } from "vitest";
import { resolveRestoredViewMode, viewMountState } from "./boot-view-restore";
import { parsePluginId } from "../plugins/plugin";

describe("resolveRestoredViewMode", () => {
  it("prefers session snapshot over localStorage", () => {
    expect(resolveRestoredViewMode({
      sessionMode: "plugin:backrooms",
      localMode: "plugin:talkers",
      fallback: "topology",
    })).toBe("plugin:backrooms");
  });
});

describe("viewMountState", () => {
  it("requires header, scene, and plugin id to match after reload", () => {
    expect(viewMountState({
      headerModeId: "plugin:backrooms",
      sceneModeId: "plugin:backrooms",
      pluginActiveId: "backrooms",
    })).toBe(true);
    expect(viewMountState({
      headerModeId: "plugin:backrooms",
      sceneModeId: "plugin:talkers",
      pluginActiveId: "backrooms",
    })).toBe(false);
  });

  it("tracks mosaic focus tile the same way", () => {
    const focused = "plugin:wifi";
    expect(viewMountState({
      headerModeId: focused,
      sceneModeId: focused,
      pluginActiveId: parsePluginId(focused),
    })).toBe(true);
  });
});
