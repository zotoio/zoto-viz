import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "yaml";
import { fieldDefault } from "./plugin";
import { configStoreId, expandPluginInstances } from "./instances";
import {
  applyPresetToValues,
  buildPluginHudCaption,
  clearUndoRing,
  createSeededRng,
  CUSTOM_PRESET_ID,
  fieldBaselineForDirty,
  isCustomConfig,
  packConfigValues,
  popUndoSnapshot,
  PRESET_BASE_META_KEY,
  pushUndoSnapshot,
  randomiseDeclaredConfig,
  resetDeclaredConfig,
  validateRandomRange,
} from "./plugin-settings";
import {
  assertConfigFields,
  parsePluginSettings,
  toPluginView,
} from "./plugin-visualisation";
import type { PluginField } from "../core/modes";
import type { PluginView } from "./plugin";
import { collectPluginConfigs, loadPluginConfig, removePluginConfigKeys, writePluginConfig } from "./plugin";
import { fillPluginFields } from "./plugin-ui";

const FIXTURE_YAML = join(dirname(fileURLToPath(import.meta.url)), "fixtures/settings-decl-pack/plugin.yml");

function fixtureSpec(): PluginView {
  const raw = yaml.parse(readFileSync(FIXTURE_YAML, "utf8"));
  return toPluginView(raw);
}

function fixtureFields(spec: PluginView): PluginField[] {
  return spec.config ?? [];
}

describe("fixture pack (settings-decl-pack/plugin.yml)", () => {
  it("loads via toPluginView", () => {
    const spec = fixtureSpec();
    expect(spec.settings?.presetField).toBe("preset");
    expect(spec.settings?.presets?.length).toBe(2);
    expect(spec.config?.find((f) => f.key === "gain")?.randomRange).toEqual([2, 8]);
  });
});

describe("parsePluginSettings / schema", () => {
  it("parses presets, presetField, hud, and sections", () => {
    const s = parsePluginSettings({
      presetField: "preset",
      presets: [{ id: "a", label: "A", values: { gain: 1 } }],
      hud: { labelFields: ["gain"] },
      sections: [{ title: "Main" }],
    });
    expect(s?.presetField).toBe("preset");
    expect(s?.presets?.[0]?.label).toBe("A");
  });

  it("rejects presets without presetField", () => {
    expect(() => parsePluginSettings({
      presets: [{ id: "a", label: "A", values: { gain: 1 } }],
    })).toThrow(/presetField/);
  });

  it("rejects bad randomRange at catalog parse", () => {
    const raw = {
      id: "bad-range",
      name: "Bad",
      version: 1,
      visualisation: {
        engine: "graph",
        settings: { presetField: "preset", presets: [{ id: "a", label: "A", values: { gain: 1 } }] },
        config: [{ key: "gain", type: "number", min: 0, max: 5, randomRange: [0, 9] }],
      },
    };
    expect(() => toPluginView(raw)).toThrow(/randomRange/);
  });

  it("rejects randomRange on text fields", () => {
    expect(() => assertConfigFields([
      { key: "t", label: "t", type: "text", randomRange: [0, 1] },
    ])).toThrow(/number fields/);
  });

  it("requires min/max for randomRange", () => {
    expect(() => assertConfigFields([
      { key: "gain", label: "g", type: "number", randomRange: [2, 8] },
    ])).toThrow(/min and max/);
  });

  it("accepts valid randomRange", () => {
    const field: PluginField = { key: "gain", label: "g", type: "number", min: 0, max: 10, randomRange: [2, 8] };
    expect(validateRandomRange(field, [2, 8])).toBe(true);
    assertConfigFields([field]);
  });
});

describe("randomiseDeclaredConfig", () => {
  it("50 seeded runs respect randomRange, step, and randomise:false", () => {
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    for (let seed = 0; seed < 50; seed++) {
      const values: Record<string, string> = {
        preset: "a",
        gain: "3",
        locked: "0.5",
        mode: "x",
      };
      randomiseDeclaredConfig(spec, fields, values, createSeededRng(seed));
      expect(values.preset).toBe(CUSTOM_PRESET_ID);
      const gain = Number(values.gain);
      expect(gain).toBeGreaterThanOrEqual(2);
      expect(gain).toBeLessThanOrEqual(8);
      expect(gain % 0.5).toBe(0);
      expect(values.locked).toBe("0.5");
      expect(["x", "y"]).toContain(values.mode);
    }
  });

  it("does not randomise text fields", () => {
    const spec: PluginView = {
      ...fixtureSpec(),
      config: [
        ...(fixtureSpec().config ?? []),
        { key: "note", label: "note", type: "text", default: "still" },
      ],
    };
    const fields = spec.config ?? [];
    const values: Record<string, string> = { note: "still", preset: "a", gain: "3", mode: "x", locked: "0.5" };
    randomiseDeclaredConfig(spec, fields, values, () => 0.5);
    expect(values.note).toBe("still");
  });
});

describe("undo ring", () => {
  beforeEach(() => {
    clearUndoRing("settings-fixture");
  });

  it("pushes on bulk ops and supports 5+ undo steps per instance", () => {
    const store = "settings-fixture";
    for (let i = 0; i < 7; i++) pushUndoSnapshot(store, { n: String(i) });
    expect(popUndoSnapshot(store)?.n).toBe("6");
    expect(popUndoSnapshot(store)?.n).toBe("5");
    expect(popUndoSnapshot(store)?.n).toBe("4");
    expect(popUndoSnapshot(store)?.n).toBe("3");
    expect(popUndoSnapshot(store)?.n).toBe("2");
    expect(popUndoSnapshot(store)?.n).toBe("1");
    expect(popUndoSnapshot(store)?.n).toBe("0");
    expect(popUndoSnapshot(store)).toBeNull();
  });

  it("isolates undo across mosaic instances", () => {
    const base = fixtureSpec();
    base.id = "settings-mosaic";
    base.instances = [
      { id: "tile-a" },
      { id: "tile-b" },
      { id: "tile-c" },
    ];
    const tiles = expandPluginInstances(base);
    const ids = tiles.map((t) => configStoreId(t));
    pushUndoSnapshot(ids[1], { v: "a1" });
    pushUndoSnapshot(ids[2], { v: "b1" });
    expect(popUndoSnapshot(ids[1])?.v).toBe("a1");
    expect(popUndoSnapshot(ids[3] ?? "missing")).toBeNull();
  });
});

describe("reset and labels", () => {
  it("partial preset → randomise → reset restores preset plus field defaults", () => {
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    const values: Record<string, string> = {
      preset: "b",
      gain: "6",
      mode: "y",
      locked: "0.5",
    };
    applyPresetToValues(spec, fields, values, "b");
    randomiseDeclaredConfig(spec, fields, values, () => 0.99);
    expect(isCustomConfig(spec, fields, values)).toBe(true);
    resetDeclaredConfig(spec, fields, values);
    expect(values.preset).toBe("b");
    expect(values.gain).toBe("6");
    expect(values.mode).toBe("y");
    expect(values.locked).toBe(fieldDefault(fields.find((f) => f.key === "locked")!));
    expect(isCustomConfig(spec, fields, values)).toBe(false);
  });

  it("label transitions preset → custom → preset", () => {
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    const values: Record<string, string> = { preset: "a", gain: "3", mode: "x", locked: "0.5" };
    expect(buildPluginHudCaption(spec, fields, values)).toBe("X · Alpha");
    values.gain = "9";
    values[PRESET_BASE_META_KEY] = "a";
    values.preset = CUSTOM_PRESET_ID;
    expect(buildPluginHudCaption(spec, fields, values)).toBe("X · Custom");
    applyPresetToValues(spec, fields, values, "b");
    expect(buildPluginHudCaption(spec, fields, values)).toBe("Y · Bravo");
  });
});

describe("dirty markers and export", () => {
  it("marks fields against active preset baseline on fresh install", () => {
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    const values: Record<string, string> = {
      preset: "a",
      gain: "4",
      mode: "x",
      locked: "0.5",
    };
    expect(fieldBaselineForDirty(spec, fields, values, "gain")).toBe("3");
    expect(fieldBaselineForDirty(spec, fields, values, "locked")).toBe("0.5");
  });

  it("omits meta keys from pack config and shows toolbar for randomisable fields", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    writePluginConfig(configStoreId(spec), {
      preset: "a",
      gain: "3",
      mode: "x",
      locked: "0.5",
      [PRESET_BASE_META_KEY]: "a",
    });
    const packed = packConfigValues(loadPluginConfig(spec, fields));
    expect(packed[PRESET_BASE_META_KEY]).toBeUndefined();
    expect(collectPluginConfigs([spec])["settings-fixture"]?.[PRESET_BASE_META_KEY]).toBeUndefined();
    const host = document.createElement("div");
    fillPluginFields(host, spec, fields, () => {});
    expect(host.querySelector(".plugin-settings-toolbar")).toBeTruthy();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Randomise", "Undo", "Reset"]),
    );
    const undo = [...host.querySelectorAll("button")].find((b) => b.textContent === "Undo");
    expect(undo?.disabled).toBe(true);
  });

  it("removes __presetBase from localStorage when cleared", () => {
    localStorage.clear();
    const id = "settings-fixture";
    writePluginConfig(id, { preset: "custom", [PRESET_BASE_META_KEY]: "a" });
    expect(localStorage.getItem("zoto-viz.plugin.settings-fixture.__presetBase")).toBe("a");
    writePluginConfig(id, { preset: "custom" });
    removePluginConfigKeys(id, [PRESET_BASE_META_KEY]);
    expect(localStorage.getItem("zoto-viz.plugin.settings-fixture.__presetBase")).toBeNull();
  });
});

describe("instance defaults", () => {
  it("applies per-instance defaults before pack fallback", () => {
    localStorage.clear();
    const spec: PluginView = {
      id: "koi-pond",
      name: "Koi",
      version: 1,
      instances: [{ id: "pond-1", defaults: { slot: "Koi Pond 1" } }],
      config: [{ key: "slot", label: "slot", type: "text", default: "Koi Pond" }],
    };
    const row = expandPluginInstances(spec).find((s) => s.instanceId === "pond-1")!;
    expect(loadPluginConfig(row, row.config).slot).toBe("Koi Pond 1");
    writePluginConfig("koi-pond", { slot: "pack-wide" });
    expect(loadPluginConfig(row, row.config).slot).toBe("Koi Pond 1");
  });
});
