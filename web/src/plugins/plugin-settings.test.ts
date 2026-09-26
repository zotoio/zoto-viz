import { describe, expect, it, beforeEach } from "vitest";
import { fieldDefault } from "./plugin";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
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
  sectionOpenState,
  validateRandomRange,
} from "./plugin-settings";
import {
  assertConfigFields,
  parsePluginSettings,
  toPluginView,
} from "./plugin-visualisation";
import type { PluginField } from "../core/modes";
import type { PluginView } from "./plugin";
import {
  collectPluginConfigs,
  invalidatePluginConfigCache,
  loadPluginConfig,
  applyPluginConfigs,
  loadPluginConfigCached,
  removePluginConfigKeys,
  writePluginConfig,
  bumpPluginCatalogRevision,
  pluginCatalogCacheRevision,
} from "./plugin";
import { fillPluginFields } from "./plugin-ui";

function fixtureSpec(): PluginView {
  return loadSettingsDeclFixture();
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
    expect(popUndoSnapshot(ids[2])?.v).toBe("b1");
    expect(popUndoSnapshot(ids[0])).toBeNull();
  });
});

describe("reset and labels", () => {
  it("partial preset → randomise → reset restores pack defaults (first preset)", () => {
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
    expect(values.preset).toBe("a");
    expect(values.gain).toBe("3");
    expect(values.mode).toBe("x");
    expect(values.locked).toBe(fieldDefault(fields.find((f) => f.key === "locked")!));
    expect(isCustomConfig(spec, fields, values)).toBe(false);
  });

  it("Bravo then gain tweak → reset returns Alpha values", () => {
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    const values: Record<string, string> = { preset: "a", gain: "3", mode: "x", locked: "0.5" };
    applyPresetToValues(spec, fields, values, "b");
    values.gain = "9";
    resetDeclaredConfig(spec, fields, values);
    expect(values.preset).toBe("a");
    expect(values.gain).toBe("3");
    expect(values.mode).toBe("x");
  });

  it("reset skips text fields even when presets[0] maps them", () => {
    const spec: PluginView = {
      id: "pond",
      name: "Pond",
      version: 1,
      settings: {
        presetField: "preset",
        presets: [
          { id: "a", label: "Pond A", values: { preset: "a", label: "Pond A", gain: 3 } },
        ],
      },
      config: [
        { key: "preset", label: "preset", type: "select", values: [["a", "A"]], default: "a" },
        { key: "label", label: "label", type: "text", default: "Pond" },
        { key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 1 },
      ],
    };
    const fields = spec.config!;
    const values: Record<string, string> = { preset: "a", label: "My custom label", gain: "5" };
    resetDeclaredConfig(spec, fields, values);
    expect(values.label).toBe("My custom label");
    expect(values.gain).toBe("3");
  });

  it("reset uses instance default preset when declared on the tile row", () => {
    const base: PluginView = {
      ...fixtureSpec(),
      instances: [{ id: "tile-b", defaults: { preset: "b" } }],
    };
    const spec = expandPluginInstances(base).find((s) => s.instanceId === "tile-b")!;
    const fields = fixtureFields(spec);
    const values: Record<string, string> = { preset: "a", gain: "3", mode: "x", locked: "0.5" };
    applyPresetToValues(spec, fields, values, "a");
    values.gain = "9";
    resetDeclaredConfig(spec, fields, values);
    expect(values.preset).toBe("b");
    expect(values.gain).toBe("6");
    expect(values.mode).toBe("y");
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
      expect.arrayContaining(["Randomise", "Undo", "Reset to defaults"]),
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

describe("boolean presets", () => {
  it("matches toggle values stored as 1/0", () => {
    const spec = fixtureSpec();
    const fields: PluginField[] = [
      ...(spec.config ?? []),
      { key: "fx", label: "fx", type: "boolean", default: false },
    ];
    spec.settings = {
      presetField: "preset",
      presets: [{ id: "bright", label: "Bright", values: { fx: true, preset: "bright" } }],
    };
    const values: Record<string, string> = { preset: "bright", fx: "1", gain: "3", mode: "x", locked: "0.5" };
    expect(isCustomConfig(spec, fields, values)).toBe(false);
    values.fx = "0";
    expect(isCustomConfig(spec, fields, values)).toBe(true);
  });
});

describe("config cache", () => {
  it("reuses the same object until invalidate", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    const a = loadPluginConfigCached(spec, fields);
    const b = loadPluginConfigCached(spec, fields);
    expect(a).toBe(b);
    writePluginConfig(configStoreId(spec), { ...a, gain: "5" });
    const c = loadPluginConfigCached(spec, fields);
    expect(c).not.toBe(a);
    expect(c.gain).toBe("5");
  });

  it("returns the same object across many reads with no writes", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    let prev = loadPluginConfigCached(spec, fields);
    for (let i = 0; i < 64; i++) {
      const next = loadPluginConfigCached(spec, fields);
      expect(next).toBe(prev);
      prev = next;
    }
  });
});

describe("toolbar without presets", () => {
  it("shows randomise when only number fields are randomisable", () => {
    const spec: PluginView = {
      id: "rand-only",
      name: "Rand",
      version: 1,
      config: [{ key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 1 }],
    };
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config!, () => {});
    expect(host.querySelector('[data-toolbar-action="randomise"]')).toBeTruthy();
    expect(host.querySelector(".plugin-settings-toolbar")).toBeTruthy();
  });
});

describe("boolean randomise", () => {
  it("skips booleans unless randomise: true", () => {
    const spec: PluginView = {
      id: "b",
      name: "B",
      version: 1,
      config: [
        { key: "a", label: "a", type: "boolean", default: false },
        { key: "b", label: "b", type: "boolean", default: false, randomise: true },
      ],
    };
    const fields = spec.config!;
    const values = { a: "0", b: "0" };
    randomiseDeclaredConfig(spec, fields, values, () => 0.99);
    expect(values.a).toBe("0");
    expect(values.b).toBe("1");
  });
});

describe("profile import", () => {
  it("cached plugin rows omit __presetBase when packed like collectSettings", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    writePluginConfig(configStoreId(spec), { preset: "custom", gain: "3", [PRESET_BASE_META_KEY]: "a" });
    const packed = packConfigValues(loadPluginConfigCached(spec, fields));
    expect(packed[PRESET_BASE_META_KEY]).toBeUndefined();
    expect(packed.gain).toBe("3");
  });

  it("drops __presetBase from applied configs", () => {
    localStorage.clear();
    applyPluginConfigs({ "settings-fixture": { gain: "3", [PRESET_BASE_META_KEY]: "a" } });
    expect(localStorage.getItem("zoto-viz.plugin.settings-fixture.__presetBase")).toBeNull();
    expect(localStorage.getItem("zoto-viz.plugin.settings-fixture.gain")).toBe("3");
  });
});

describe("section collapsed", () => {
  it("honours collapsed: true on first section", () => {
    const spec = fixtureSpec();
    expect(spec.settings?.sections?.[0]?.collapsed).toBe(true);
    expect(sectionOpenState("settings-fixture", "Tuning", spec.settings!.sections!, 0)).toBe(false);
  });
});

describe("catalog revision cache", () => {
  it("picks up new field defaults after bumpPluginCatalogRevision", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    const rev = pluginCatalogCacheRevision();
    loadPluginConfigCached(spec, fields);
    const bumped = {
      ...spec,
      config: (spec.config ?? []).map((f) => (f.key === "gain" ? { ...f, default: 9 } : f)),
    };
    bumpPluginCatalogRevision();
    expect(pluginCatalogCacheRevision()).toBe(rev + 1);
    const bumpedFields = fixtureFields(bumped);
    expect(loadPluginConfigCached(bumped, bumpedFields).gain).toBe("9");
  });

  it("cached reads after bumpPluginCatalogRevision pick up new defaults", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    const fields = fixtureFields(spec);
    loadPluginConfigCached(spec, fields);
    const bumped = {
      ...spec,
      config: (spec.config ?? []).map((f) => (f.key === "gain" ? { ...f, default: 7 } : f)),
    };
    bumpPluginCatalogRevision();
    expect(loadPluginConfigCached(bumped, fixtureFields(bumped)).gain).toBe("7");
  });
});

describe("reset text fields", () => {
  it("does not reset text inputs", () => {
    const spec: PluginView = {
      id: "text-reset",
      name: "Text",
      version: 1,
      config: [
        { key: "gateway", label: "gw", type: "text", default: "ours" },
        { key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 1 },
      ],
    };
    const fields = spec.config!;
    const values: Record<string, string> = { gateway: "192.168.1.1", gain: "5" };
    resetDeclaredConfig(spec, fields, values);
    expect(values.gateway).toBe("192.168.1.1");
    expect(values.gain).toBe("1");
  });
});

describe("undo restores meta", () => {
  it("restores __presetBase from the snapshot", () => {
    const store = "settings-fixture";
    clearUndoRing(store);
    pushUndoSnapshot(store, { preset: "custom", gain: "3", [PRESET_BASE_META_KEY]: "a" });
    const snap = popUndoSnapshot(store)!;
    expect(snap[PRESET_BASE_META_KEY]).toBe("a");
  });
});
