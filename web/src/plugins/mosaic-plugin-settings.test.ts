import { beforeEach, describe, expect, it } from "vitest";
import { applyInstance, configStoreId, countTilesSharingConfigStore, packScopeNoteText } from "./instances";
import { packWallScopeFromAnim } from "./pack-wall-scope";
import { DEFAULT_DREAM } from "../graph/scene";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import {
  applyPresetToValues,
  buildPluginHudCaption,
  clearUndoRing,
  fieldBaselineForDirty,
  pushUndoSnapshot,
  randomiseDeclaredConfig,
  createSeededRng,
} from "./plugin-settings";
import { loadPluginConfig, writePluginConfig, type PluginView } from "./plugin";
import { fillPluginFields } from "./plugin-ui";

function fixtureView(): PluginView {
  return loadSettingsDeclFixture();
}

function mosaicPack(): PluginView {
  const base = fixtureView();
  return {
    ...base,
    id: "settings-mosaic",
    instances: [
      { id: "tile-a" },
      { id: "tile-b" },
      { id: "tile-c" },
      { id: "tile-d" },
    ],
  };
}

function tileSpecs(): PluginView[] {
  const base = mosaicPack();
  return (["tile-a", "tile-b", "tile-c", "tile-d"] as const).map((instId) => {
    const row = base.instances!.find((i) => i.id === instId)!;
    return applyInstance(base, row);
  });
}

describe("2x2 mosaic preset isolation (configStoreId)", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const s of tileSpecs()) clearUndoRing(configStoreId(s));
  });

  it("randomise on tile 1 leaves tiles 2–4 presets and labels intact across reload", () => {
    const tiles = tileSpecs();
    const fields = tiles[0]!.config ?? [];
    const presets = ["a", "b", "a", "b"] as const;
    const saved: Record<string, Record<string, string>> = {};

    for (let i = 0; i < 4; i++) {
      const spec = tiles[i]!;
      const values: Record<string, string> = { preset: presets[i], gain: String(3 + i), mode: i % 2 ? "y" : "x", locked: "0.5" };
      applyPresetToValues(spec, fields, values, presets[i]);
      writePluginConfig(configStoreId(spec), values);
      saved[configStoreId(spec)] = { ...values };
    }

    const labelsBefore = tiles.map((s) => buildPluginHudCaption(s, fields, loadPluginConfig(s, fields)));

    const tile1 = tiles[0]!;
    const t1Values = loadPluginConfig(tile1, fields);
    pushUndoSnapshot(configStoreId(tile1), { ...t1Values });
    randomiseDeclaredConfig(tile1, fields, t1Values, createSeededRng(42));
    writePluginConfig(configStoreId(tile1), t1Values);

    expect(configStoreId(tile1)).toBe("settings-mosaic:tile-a");

    for (let i = 1; i < 4; i++) {
      const spec = tiles[i]!;
      const sid = configStoreId(spec);
      const v = loadPluginConfig(spec, fields);
      expect(v.preset).toBe(presets[i]);
      expect(v.gain).toBe(saved[sid]!.gain);
      expect(buildPluginHudCaption(spec, fields, v)).toBe(labelsBefore[i]);
    }

    expect(loadPluginConfig(tiles[0]!, fields).preset).toBe("custom");
    expect(loadPluginConfig(tiles[1]!, fields).preset).toBe("b");
  });
});

describe("pack scope note", () => {
  it("scope note uses config store not pack id on mosaic walls", () => {
    const mosaic = mosaicPack();
    const scope = {
      mosaicOn: true,
      tileModeIds: ["plugin:settings-mosaic", "plugin:settings-mosaic:tile-a"],
    };
    expect(packScopeNoteText(mosaic, scope)).toBeNull();
  });

  it("counts tiles sharing the same config store id", () => {
    const spec = fixtureView();
    expect(countTilesSharingConfigStore(spec, [])).toBe(0);
    expect(countTilesSharingConfigStore(spec, ["plugin:settings-fixture", "plugin:other"])).toBe(1);
    expect(countTilesSharingConfigStore(spec, ["plugin:settings-fixture", "plugin:settings-fixture"])).toBe(2);
    const inst = applyInstance(mosaicPack(), { id: "tile-a" });
    expect(countTilesSharingConfigStore(inst, ["plugin:settings-mosaic", "plugin:settings-mosaic:tile-a"])).toBe(1);
  });

  it("shows shared scope note when the same pack sits on two mosaic slots", () => {
    const spec = fixtureView();
    const scope = {
      mosaicOn: true,
      tileModeIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
    };
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelector(".plugin-pack-scope-note")?.textContent).toContain("Changes apply to all");
    expect(countTilesSharingConfigStore(spec, scope.tileModeIds)).toBe(2);
  });

  it("wires packWallScopeFromAnim through fillPluginFields", () => {
    const spec = fixtureView();
    const scope = packWallScopeFromAnim({
      ...DEFAULT_DREAM,
      mosaic: "4",
      mosaicTiles: ["plugin:settings-fixture", "plugin:topology"],
    });
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelector(".plugin-pack-scope-note")).toBeNull();

    const perTile = applyInstance(mosaicPack(), { id: "tile-a" });
    const hostTile = document.createElement("div");
    fillPluginFields(hostTile, perTile, perTile.config ?? [], () => {});
    expect(hostTile.querySelector(".plugin-pack-scope-note")?.textContent).toContain("this tile only");
  });
});
