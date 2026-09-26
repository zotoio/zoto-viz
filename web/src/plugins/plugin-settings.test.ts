import { describe, expect, it, beforeEach } from "vitest";
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
  assertFieldRandomRanges,
  parsePluginSettings,
  toPluginView,
} from "./plugin-visualisation";
import type { PluginField } from "../core/modes";
import type { PluginView } from "./plugin";
import { collectPluginConfigs, loadPluginConfig, writePluginConfig } from "./plugin";
import { fillPluginFields } from "./plugin-ui";

const FIXTURE_FIELDS: PluginField[] = [
  { key: "preset", label: "preset", type: "select", values: [["a", "Alpha"], ["custom", "custom"]], default: "a" },
  { key: "gain", label: "gain", type: "number", min: 0, max: 10, step: 0.5, default: 3, randomRange: [2, 8] },
  { key: "locked", label: "locked", type: "number", min: 0, max: 1, default: 0.5, randomise: false },
  { key: "mode", label: "mode", type: "select", values: [["x", "X"], ["y", "Y"]], default: "x" },
];

function fixtureSpec(): PluginView {
  return {
    id: "settings-fixture",
    name: "Settings fixture",
    version: 1,
    engine: "graph",
    config: FIXTURE_FIELDS,
    settings: {
      presetField: "preset",
      presets: [
        { id: "a", label: "Alpha", values: { gain: 3, mode: "x", locked: 0.5 } },
        { id: "b", label: "Bravo", values: { gain: 6, mode: "y", locked: 0.5 } },
      ],
      hud: { labelFields: ["mode", "preset"] },
      sections: [{ title: "Tuning", collapsed: true }, { title: "Locked" }],
    },
  };
}

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
    expect(s?.hud?.labelFields).toEqual(["gain"]);
    expect(s?.sections?.[0]?.title).toBe("Main");
  });

  it("rejects bad randomRange at catalog parse", () => {
    const raw = {
      id: "bad-range",
      name: "Bad",
      version: 1,
      visualisation: {
        engine: "graph",
        config: [{ key: "gain", type: "number", min: 0, max: 5, randomRange: [0, 9] }],
        settings: { presets: [{ id: "a", label: "A", values: { gain: 1 } }] },
      },
    };
    expect(() => toPluginView(raw)).toThrow(/randomRange/);
  });

  it("accepts valid randomRange", () => {
    const field: PluginField = { key: "gain", label: "g", type: "number", min: 0, max: 10, randomRange: [2, 8] };
    expect(validateRandomRange(field, [2, 8])).toBe(true);
    assertFieldRandomRanges([field], { presets: [{ id: "a", label: "A", values: { gain: 1 } }] });
  });
});

describe("randomiseDeclaredConfig", () => {
  it("50 seeded runs respect randomRange, step, and randomise:false", () => {
    const spec = fixtureSpec();
    const fields = FIXTURE_FIELDS;
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
    base.instances = [
      { id: "settings-fixture" },
      { id: "tile-a" },
      { id: "tile-b" },
      { id: "tile-c" },
    ];
    const tiles = expandPluginInstances(base);
    expect(tiles.length).toBe(4);
    const ids = tiles.map((t) => configStoreId(t));
    pushUndoSnapshot(ids[1], { v: "a1" });
    pushUndoSnapshot(ids[2], { v: "b1" });
    expect(popUndoSnapshot(ids[1])?.v).toBe("a1");
    expect(popUndoSnapshot(ids[2])?.v).toBe("b1");
    expect(popUndoSnapshot(ids[3])).toBeNull();
  });
});

describe("reset and labels", () => {
  it("resets from preset and from custom derived preset", () => {
    const spec = fixtureSpec();
    const fields = FIXTURE_FIELDS;
    const values: Record<string, string> = { preset: "a", gain: "3", mode: "x", locked: "0.5" };
    randomiseDeclaredConfig(spec, fields, values, () => 0.99);
    expect(isCustomConfig(spec, fields, values)).toBe(true);
    resetDeclaredConfig(spec, fields, values);
    expect(values.preset).toBe("a");
    expect(values.gain).toBe("3");
    values[PRESET_BASE_META_KEY] = "b";
    values.preset = CUSTOM_PRESET_ID;
    values.gain = "9";
    resetDeclaredConfig(spec, fields, values);
    expect(values.preset).toBe("b");
    expect(values.gain).toBe("6");
  });

  it("label transitions preset → custom → preset", () => {
    const spec = fixtureSpec();
    const fields = FIXTURE_FIELDS;
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
    const fields = FIXTURE_FIELDS;
    const values: Record<string, string> = {
      preset: "a",
      gain: "4",
      mode: "x",
      locked: "0.5",
    };
    expect(fieldBaselineForDirty(spec, fields, values, "gain")).toBe("3");
    expect(fieldBaselineForDirty(spec, fields, values, "locked")).toBe("0.5");
  });

  it("omits meta keys from pack config and profile export", () => {
    localStorage.clear();
    const spec = fixtureSpec();
    writePluginConfig(configStoreId(spec), {
      preset: "a",
      gain: "3",
      mode: "x",
      locked: "0.5",
      [PRESET_BASE_META_KEY]: "a",
    });
    const packed = packConfigValues(loadPluginConfig(spec, FIXTURE_FIELDS));
    expect(packed[PRESET_BASE_META_KEY]).toBeUndefined();
    expect(collectPluginConfigs([spec])["settings-fixture"]?.[PRESET_BASE_META_KEY]).toBeUndefined();
    const host = document.createElement("div");
    fillPluginFields(host, spec, FIXTURE_FIELDS, () => {});
    expect(host.querySelector(".plugin-settings-toolbar")).toBeTruthy();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["Randomise", "Undo", "Reset"]),
    );
    const exported = collectPluginConfigs([spec])["settings-fixture"] ?? {};
    expect(exported.randomise).toBeUndefined();
    expect(exported.undo).toBeUndefined();
    expect(exported.resetPreset).toBeUndefined();
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

describe("import boundary", () => {
  it("host settings module does not import plugins/src", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const f of ["plugin-settings.ts", "plugin-ui.ts", "plugin-visualisation.ts"]) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(text).not.toMatch(/plugins\/src\//);
    }
  });
});
