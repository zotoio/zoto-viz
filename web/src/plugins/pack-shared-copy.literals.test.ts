import { beforeEach, describe, expect, it } from "vitest";
import { fillPluginFields } from "./plugin-ui";
import {
  NEST_NO_CAMERAS,
  packLastTileDiscardMessage,
  perTilePackScopeNoteMessage,
} from "./pack-shared-copy";
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
    const spec = { ...loadSettingsDeclFixture(), instanceId: "alt" };
    expect(packScopeNoteText(spec)).toBe(
      "These settings apply to this tile only. Anything you change here overrides the shared Settings fixture settings.",
    );
  });

  it("per-tile scope note renders hostile pack name as plain text", () => {
    const hostile = "<img src=x>";
    const spec = { ...loadSettingsDeclFixture(), instanceId: "alt", name: hostile };
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, {
      wallScope: { mosaicOn: false, tileModeIds: [] },
    });
    const note = host.querySelector(".plugin-pack-scope-note");
    expect(note?.childElementCount).toBe(0);
    expect(note?.textContent).toBe(perTilePackScopeNoteMessage(hostile));
  });
});
