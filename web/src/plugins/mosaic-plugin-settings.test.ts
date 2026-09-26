import { beforeEach, describe, expect, it } from "vitest";
import { applyInstance, configStoreId, packScopeNoteText } from "./instances";
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
  it("shows shared note for multi-instance pack and per-tile note for instance rows", () => {
    const single = fixtureView();
    expect(packScopeNoteText(single)).toBeNull();

    const multi = mosaicPack();
    expect(packScopeNoteText(multi)).toContain("Applies to all");

    const perTile = applyInstance(mosaicPack(), { id: "tile-a" });
    expect(packScopeNoteText(perTile)).toContain("this tile only");

    const host = document.createElement("div");
    fillPluginFields(host, perTile, perTile.config ?? [], () => {});
    expect(host.querySelector(".plugin-pack-scope-note")?.textContent).toContain("this tile only");
  });
});
