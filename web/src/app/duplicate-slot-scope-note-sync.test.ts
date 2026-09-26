import { beforeEach, describe, expect, it } from "vitest";
import { syncPackScopeNote } from "../plugins/plugin-ui";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import type { PackWallScope } from "../plugins/instances";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > pack scope note sync", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("repeat sync with unchanged copy does not rewrite the note node", () => {
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

    const wall: PackWallScope = {
      tileModeIds: [PACK, `${PACK}!1`, "plugin:topology"],
      packId: spec.id,
      mosaicOn: true,
    };
    syncPackScopeNote(host, spec, wall);
    const note = host.querySelector(".plugin-pack-scope-note");
    expect(note).toBeTruthy();
    const marker = document.createComment("marker");
    note!.appendChild(marker);
    syncPackScopeNote(host, spec, wall);
    expect(host.querySelector(".plugin-pack-scope-note")?.contains(marker)).toBe(true);
  });
});
