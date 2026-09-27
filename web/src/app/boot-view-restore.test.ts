import { describe, expect, it } from "vitest";
import {
  reconcileMosaicTilesWithMode,
  resolveRestoredViewMode,
} from "./boot-view-restore";

describe("resolveRestoredViewMode", () => {
  it("prefers session snapshot over localStorage", () => {
    expect(resolveRestoredViewMode({
      sessionMode: "plugin:backrooms",
      localMode: "plugin:talkers",
      fallback: "topology",
    })).toBe("plugin:backrooms");
  });
});

describe("reconcileMosaicTilesWithMode", () => {
  it("replaces the focused slot when mode is missing from tiles", () => {
    expect(reconcileMosaicTilesWithMode(
      ["plugin:topology", "plugin:wifi"],
      "plugin:backrooms",
      "plugin:topology",
    )).toEqual(["plugin:backrooms", "plugin:wifi"]);
  });
});

