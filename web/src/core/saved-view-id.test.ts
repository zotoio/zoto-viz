import { describe, expect, it } from "vitest";
import { remapSavedViewId } from "./saved-view-id";
import { resolveRestoredViewMode, reconcileMosaicTilesWithMode } from "../app/boot-view-restore";

describe("remapSavedViewId", () => {
  it("maps retired plugin:cpu-pong to plugin:cpupong", () => {
    expect(remapSavedViewId("plugin:cpu-pong")).toBe("plugin:cpupong");
  });

  it("leaves canonical ids unchanged", () => {
    expect(remapSavedViewId("plugin:cpupong")).toBe("plugin:cpupong");
    expect(remapSavedViewId("topology")).toBe("topology");
  });
});

describe("resolveRestoredViewMode", () => {
  it("remaps saved plugin:cpu-pong from localStorage on load", () => {
    expect(
      resolveRestoredViewMode({
        localMode: "plugin:cpu-pong",
        fallback: "topology",
      }),
    ).toBe("plugin:cpupong");
  });
});

describe("reconcileMosaicTilesWithMode", () => {
  it("remaps plugin:cpu-pong in mosaic tiles", () => {
    expect(
      reconcileMosaicTilesWithMode(
        ["plugin:cpu-pong", "plugin:topology"],
        "plugin:topology",
      ),
    ).toEqual(["plugin:cpupong", "plugin:topology"]);
  });
});
