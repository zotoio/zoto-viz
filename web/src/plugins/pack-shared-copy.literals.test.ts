import { beforeEach, describe, expect, it } from "vitest";
import { NEST_NO_CAMERAS, packLastTileDiscardMessage } from "./pack-shared-copy";
import { packScopeNoteText } from "./instances";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";

describe("pack shared copy literals", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("NEST_NO_CAMERAS", () => {
    expect(NEST_NO_CAMERAS).toBe("No cameras found for this Nest account.");
  });

  it("pack last tile discard message for Settings fixture", () => {
    expect(packLastTileDiscardMessage("Settings fixture")).toBe(
      "Your unsaved Settings fixture changes were discarded because its last tile was removed.",
    );
  });

  it("per-tile instance scope note", () => {
    expect(packScopeNoteText({ ...loadSettingsDeclFixture(), instanceId: "alt" })).toBe(
      "Settings apply to this tile only. Instance defaults override shared pack values.",
    );
  });
});
