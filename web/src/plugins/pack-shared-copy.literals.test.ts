import { beforeEach, describe, expect, it } from "vitest";
import { applyInstance, packScopeNoteText } from "./instances";
import { fillPluginFields } from "./plugin-ui";
import {
  NEST_NO_CAMERAS,
  packLastTileDiscardMessage,
  perTilePackScopeNoteMessage,
} from "./pack-shared-copy";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { tileDisplayName } from "./plugin";
import { engineDispatch } from "./plugin-visualisation";
import { viewCaption } from "../core/modes";
import { ALT_FEED_INSTANCE, HEADLINES_PACK } from "./test/load-settings-fixture";

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

  it("shared pack scope note for two tiles ends with a full stop", () => {
    const spec = loadSettingsDeclFixture();
    const scope = {
      mosaicOn: true,
      tileModeIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
    };
    expect(packScopeNoteText(spec, scope)).toBe(
      "Changes apply to all 2 Settings fixture tiles on this wall.",
    );
  });

  it("per-tile instance scope note", () => {
    const spec = applyInstance(HEADLINES_PACK, ALT_FEED_INSTANCE);
    const text = packScopeNoteText(spec)!;
    expect(text.split("overrides ")[1]).toBe("the shared Headlines settings.");
    expect(text).toBe(
      "These settings apply to this tile only. Anything you change here overrides the shared Headlines settings.",
    );
  });

  it("per-tile scope note renders pack name as plain text", () => {
    const hostile = "<img src=x>";
    const spec = { ...loadSettingsDeclFixture(), instanceId: "alt", packName: hostile };
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, {
      wallScope: { mosaicOn: false, tileModeIds: [] },
    });
    const note = host.querySelector(".plugin-pack-scope-note");
    expect(note?.childElementCount).toBe(0);
    expect(note?.textContent).toBe(perTilePackScopeNoteMessage(hostile));
  });

  it("drawer view title renders hostile instance label as plain text", () => {
    const hostile = "<img src=x>";
    const spec = applyInstance(HEADLINES_PACK, { id: "alt", name: hostile });
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, {
      wallScope: { mosaicOn: false, tileModeIds: [] },
    });
    const title = host.querySelector(".sec-title");
    expect(title?.childElementCount).toBe(0);
    const dispatch = engineDispatch(spec);
    const expectedTitle = viewCaption({
      id: spec.id,
      label: tileDisplayName(spec),
      graphBase: dispatch.graphBase,
      arcadeId: dispatch.arcadeId,
    });
    expect(title?.textContent).toBe(expectedTitle);
  });
});

describe("applyInstance instanceLabel normalisation", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("stores undefined for whitespace-only instance labels", () => {
    expect(applyInstance(HEADLINES_PACK, { id: "alt", name: "   " }).instanceLabel).toBeUndefined();
  });

  it.each([
    { label: undefined as string | undefined, expected: "Headlines" },
    { label: "", expected: "Headlines" },
    { label: "Alt feed", expected: "Alt feed" },
  ])("tileDisplayName for instance label %j", ({ label, expected }) => {
    const inst = label === undefined ? { id: "alt" } : { id: "alt", name: label };
    expect(tileDisplayName(applyInstance(HEADLINES_PACK, inst))).toBe(expected);
  });
});

describe("applyInstance packName", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("keeps packName when instance row has a label", () => {
    expect(applyInstance(HEADLINES_PACK, ALT_FEED_INSTANCE).packName).toBe("Headlines");
  });
});
