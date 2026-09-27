import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { fillPluginFields } from "../plugins/plugin-ui";
import { packScopeNoteText } from "../plugins/instances";
import { hostModeById } from "./host-mode";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { Settings } from "../ui/settings";
import { syncPluginFieldsFromSettingsEdit } from "./plugin-fields-from-settings";

import { HEADLINES_PACK } from "../../test/fixtures/headlines-alt-feed";

const PACK = "plugin:settings-fixture";

function headlinesTileModeIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? "plugin:headlines" : `plugin:headlines!${i}`));
}

describe("duplicate slot shared config > scope note when two tiles share one store", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("shows Changes apply to all 2 when the pack is on two mosaic slots", () => {
    const spec = loadSettingsDeclFixture();
    const scope = {
      mosaicOn: true,
      tileModeIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
    };
    expect(packScopeNoteText(spec, scope)).toBe(
      `Changes apply to all 2 ${spec.packName} tiles on this wall.`,
    );
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelector(".plugin-pack-scope-note")?.textContent).toBe(
      `Changes apply to all 2 ${spec.packName} tiles on this wall.`,
    );
  });

  it("hides the shared scope note when the pack is on only one tile", () => {
    const spec = loadSettingsDeclFixture();
    const scope = { mosaicOn: true, tileModeIds: ["plugin:settings-fixture", "plugin:topology"] };
    expect(packScopeNoteText(spec, scope)).toBeNull();
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelector(".plugin-pack-scope-note")).toBeNull();
  });

  it.each([
    { n: 1, tail: "", noteCount: 0, full: null as string | null },
    { n: 2, tail: "all 2 Headlines tiles on this wall.", noteCount: 1, full: "Changes apply to all 2 Headlines tiles on this wall." },
    { n: 4, tail: "all 4 Headlines tiles on this wall.", noteCount: 1, full: "Changes apply to all 4 Headlines tiles on this wall." },
  ])("shared pack scope note when $n Headlines tiles are on the wall", ({ n, tail, noteCount, full }) => {
    const scope = { mosaicOn: true, tileModeIds: headlinesTileModeIds(n) };
    const noteText = packScopeNoteText(HEADLINES_PACK, scope);
    if (noteText) {
      expect(noteText.replace(/^Changes apply to /, "")).toBe(tail);
    } else {
      expect(tail).toBe("");
    }
    const host = document.createElement("div");
    fillPluginFields(host, HEADLINES_PACK, HEADLINES_PACK.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelectorAll(".plugin-pack-scope-note")).toHaveLength(noteCount);
    if (full) {
      expect(host.querySelector(".plugin-pack-scope-note")?.textContent).toBe(full);
    }
  });
});

describe("duplicate slot shared config > live edit applies to every sharing tile", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("calls setMode on both duplicate tiles via main onPluginFields mosaic sync", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-shared-sync", onChange: () => {} });
    settings.openView(`${PACK}!1`);
    const sceneA = { setMode: vi.fn() };
    const sceneB = { setMode: vi.fn() };
    const mosaic = {
      on: true,
      tileIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
      graphScene: (id: string) => (id === "plugin:settings-fixture" ? sceneA : sceneB),
    };
    const opts = { gain: "9", preset: "a", mode: "x", locked: "0.5" };
    syncPluginFieldsFromSettingsEdit({
      settings,
      fallbackModeId: () => PACK,
      hostModeById,
      optsFor: () => opts,
      mosaic,
      scene: { setMode: vi.fn() },
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      setCurrentOpts: () => {},
      setSkyPrompt: () => {},
      setNestLook: () => {},
      viewPromptKey: "prompt",
    });
    expect(sceneA.setMode).toHaveBeenCalledTimes(1);
    expect(sceneB.setMode).toHaveBeenCalledTimes(1);
    expect(sceneA.setMode.mock.calls[0]![0].id).toBe("plugin:settings-fixture");
    expect(sceneB.setMode.mock.calls[0]![0].id).toBe("plugin:settings-fixture!1");
    expect(sceneA.setMode.mock.calls[0]![1]).toEqual(opts);
    expect(sceneB.setMode.mock.calls[0]![1]).toEqual(opts);
  });

  it("uses settings viewFocus instead of the catalog fallback mode id", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-view-focus", onChange: () => {} });
    settings.openView(`${PACK}!1`);
    expect(settings.viewFocus).toBe(`${PACK}!1`);
    const scene = { setMode: vi.fn() };
    syncPluginFieldsFromSettingsEdit({
      settings,
      fallbackModeId: () => "plugin:topology",
      hostModeById,
      optsFor: () => ({ gain: "5", preset: "a" }),
      mosaic: null,
      scene,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      setCurrentOpts: () => {},
      setSkyPrompt: () => {},
      setNestLook: () => {},
      viewPromptKey: "prompt",
    });
    expect(scene.setMode).toHaveBeenCalledTimes(1);
    expect(scene.setMode.mock.calls[0]![0].id).toBe(`${PACK}!1`);
  });
});
