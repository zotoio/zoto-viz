import { beforeEach, describe, expect, it } from "vitest";
import { syncPackScopeNote } from "../plugins/plugin-ui";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import type { PackWallScope } from "../plugins/instances";
import { PACK_SCOPE_NOTE_SELECTOR, pinPackScopeNoteWriteCounter } from "./test/pack-scope-note-write-pin";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > pack scope note sync", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("600 repeat syncs with unchanged copy: 0 note writes; one tile-count change: 1 write", () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    const view = document.createElement("div");
    view.className = "plugin-layer";
    view.dataset.layer = "view";
    const title = document.createElement("div");
    title.className = "sec-title";
    title.textContent = "View";
    view.append(title);
    host.append(view);
    document.body.append(host);

    const wallTwo: PackWallScope = {
      tileModeIds: [PACK, `${PACK}!1`, "plugin:topology"],
      packId: spec.id,
      mosaicOn: true,
    };
    syncPackScopeNote(host, spec, wallTwo);
    const note = host.querySelector<HTMLElement>(PACK_SCOPE_NOTE_SELECTOR);
    expect(note).toBeTruthy();
    expect(note!.isConnected).toBe(true);
    expect(note).toBe(host.querySelector(PACK_SCOPE_NOTE_SELECTOR));
    const pin = pinPackScopeNoteWriteCounter(host);

    for (let i = 0; i < 600; i++) {
      syncPackScopeNote(host, spec, wallTwo);
    }
    pin.assertStillPinned();
    expect(pin.writeCount()).toBe(0);

    const wallThree: PackWallScope = {
      tileModeIds: [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"],
      packId: spec.id,
      mosaicOn: true,
    };
    syncPackScopeNote(host, spec, wallThree);
    pin.assertStillPinned();
    expect(pin.writeCount()).toBe(1);

    host.remove();
  });
});
