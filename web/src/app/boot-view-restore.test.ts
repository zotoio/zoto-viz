import { beforeEach, describe, expect, it } from "vitest";
import {
  reconcileMosaicTilesWithMode,
  resolveRestoredViewMode,
} from "./boot-view-restore";

describe("resolveRestoredViewMode", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("prefers session snapshot over localStorage", () => {
    expect(resolveRestoredViewMode({
      sessionMode: "plugin:backrooms",
      localMode: "plugin:talkers",
      fallback: "topology",
    })).toBe("plugin:backrooms");
  });
});

describe("reconcileMosaicTilesWithMode", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("replaces the focused slot when mode is missing from tiles", () => {
    expect(reconcileMosaicTilesWithMode(
      ["plugin:topology", "plugin:wifi"],
      "plugin:backrooms",
      "plugin:topology",
    )).toEqual(["plugin:backrooms", "plugin:wifi"]);
  });
});

