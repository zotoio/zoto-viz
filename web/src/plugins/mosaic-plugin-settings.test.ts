import { beforeEach, describe, expect, it } from "vitest";
import { applyInstance, configStoreId } from "./instances";
import {
  applyPresetToValues,
  buildPluginHudCaption,
  clearUndoRing,
  fieldBaselineForDirty,
  pushUndoSnapshot,
  randomiseDeclaredConfig,
} from "./plugin-settings";
import { loadPluginConfig, writePluginConfig } from "./plugin";
import type { PluginField } from "../core/modes";
import type { PluginView } from "./plugin";
import { createSeededRng } from "./plugin-settings";
import { createFractalDriveRuntime } from "../../../plugins/src/fractal-zoom/frontend/drive";
import { IDLE_POINTER } from "../../../plugins/src/fractal-zoom/frontend/interaction";
import { mosaicTileVizSteps, runMosaicTileVizFrame } from "./mosaic-viz-tiles";

const FIELDS: PluginField[] = [
  { key: "preset", label: "preset", type: "select", values: [["a", "Alpha"], ["b", "Bravo"], ["c", "Charlie"]], default: "a" },
  { key: "gain", label: "gain", type: "number", min: 0, max: 10, step: 0.5, default: 3, randomRange: [2, 8] },
  { key: "mode", label: "mode", type: "select", values: [["x", "X"], ["y", "Y"]], default: "x" },
];

function mosaicPack(): PluginView {
  return {
    id: "koi-pond",
    name: "Koi Pond",
    version: 1,
    engine: "graph",
    config: FIELDS,
    instances: [
      { id: "pond-1", defaults: { slot: "Koi Pond 1" } },
      { id: "pond-2", defaults: { slot: "Koi Pond 2" } },
      { id: "pond-3", defaults: { slot: "Koi Pond 3" } },
      { id: "pond-4", defaults: { slot: "Koi Pond 4" } },
    ],
    settings: {
      presetField: "preset",
      presets: [
        { id: "a", label: "Alpha", values: { preset: "a", gain: 3, mode: "x" } },
        { id: "b", label: "Bravo", values: { preset: "b", gain: 6, mode: "y" } },
        { id: "c", label: "Charlie", values: { preset: "c", gain: 4, mode: "x" } },
      ],
      hud: { labelFields: ["mode", "preset"] },
    },
  };
}

function tileSpecs(): PluginView[] {
  const base = mosaicPack();
  return (["pond-1", "pond-2", "pond-3", "pond-4"] as const).map((instId) => {
    const row = base.instances!.find((i) => i.id === instId)!;
    const modeId = `plugin:koi-pond:${instId}`;
    const spec = applyInstance(base, row);
    return { ...spec, configViewId: modeId };
  });
}

function specForMode(modeId: string): PluginView | null {
  const inst = modeId.split(":").pop();
  return tileSpecs().find((s) => s.instanceId === inst) ?? null;
}

function storeId(spec: PluginView): string {
  return configStoreId(spec, spec.configViewId);
}

function persist(spec: PluginView, values: Record<string, string>): void {
  writePluginConfig(storeId(spec), values);
}

function read(spec: PluginView): Record<string, string> {
  return loadPluginConfig(spec, FIELDS);
}

describe("2x2 mosaic preset isolation (configStoreId)", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const s of tileSpecs()) clearUndoRing(storeId(s));
  });

  it("randomise on tile 1 leaves tiles 2–4 presets, labels, and dirty markers intact across reload", () => {
    const tiles = tileSpecs();
    const presets = ["a", "b", "c", "b"] as const;
    const saved: Record<string, Record<string, string>> = {};

    for (let i = 0; i < 4; i++) {
      const spec = tiles[i]!;
      const values: Record<string, string> = { preset: presets[i], gain: String(3 + i), mode: i % 2 ? "y" : "x" };
      applyPresetToValues(spec, FIELDS, values, presets[i]);
      persist(spec, values);
      saved[storeId(spec)] = { ...values };
    }

    const labelsBefore = tiles.map((s) => buildPluginHudCaption(s, FIELDS, read(s)));
    const dirtyBefore = tiles.map((s) => {
      const v = read(s);
      return fieldBaselineForDirty(s, FIELDS, v, "gain") !== undefined
        && String(v.gain) !== String(fieldBaselineForDirty(s, FIELDS, v, "gain"));
    });

    const tile1 = tiles[0]!;
    const t1Values = read(tile1);
    pushUndoSnapshot(storeId(tile1), { ...t1Values });
    randomiseDeclaredConfig(tile1, FIELDS, t1Values, createSeededRng(42));
    persist(tile1, t1Values);

    expect(storeId(tile1)).toBe("koi-pond:pond-1");
    expect(localStorage.getItem("zoto-viz.plugin.koi-pond.gain")).toBeNull();

    for (let i = 1; i < 4; i++) {
      const spec = tiles[i]!;
      const sid = storeId(spec);
      const v = read(spec);
      expect(v.preset).toBe(presets[i]);
      expect(v.gain).toBe(saved[sid]!.gain);
      expect(v.mode).toBe(saved[sid]!.mode);
      expect(buildPluginHudCaption(spec, FIELDS, v)).toBe(labelsBefore[i]);
      expect(
        fieldBaselineForDirty(spec, FIELDS, v, "gain") !== undefined
          && String(v.gain) !== String(fieldBaselineForDirty(spec, FIELDS, v, "gain")),
      ).toBe(dirtyBefore[i]);
    }

    for (const s of tiles) clearUndoRing(storeId(s));

    const labelsAfterReload = tiles.map((s) => buildPluginHudCaption(s, FIELDS, read(s)));
    expect(labelsAfterReload.slice(1)).toEqual(labelsBefore.slice(1));
    expect(read(tiles[0]!).preset).toBe("custom");
    expect(read(tiles[1]!).preset).toBe("b");
  });
});

describe("mosaic tile drive (one advance per tile per frame)", () => {
  it("runs four fractal drive instances once each with isolated zoom state", () => {
    const runtimes = new Map<string, ReturnType<typeof createFractalDriveRuntime>>();
    const tileIds = [
      "plugin:koi-pond:pond-1",
      "plugin:koi-pond:pond-2",
      "plugin:koi-pond:pond-3",
      "plugin:koi-pond:pond-4",
    ];
    const steps = mosaicTileVizSteps(tileIds, specForMode, (_spec, storeId, modeId) => (t) => {
      let rt = runtimes.get(storeId);
      if (!rt) {
        rt = createFractalDriveRuntime();
        runtimes.set(storeId, rt);
      }
      const slot = modeId.split(":").pop() ?? "0";
      rt.packDrive(t, 1 / 60, 0, 16 / 10, {
        preset: "bulb-classic",
        fractalType: "mandelbulb",
        zoomSpeed: String(0.2 + slot.charCodeAt(slot.length - 1) * 0.01),
      }, IDLE_POINTER);
    });

    expect(steps.map((s) => s.storeId).sort()).toEqual([
      "koi-pond:pond-1",
      "koi-pond:pond-2",
      "koi-pond:pond-3",
      "koi-pond:pond-4",
    ]);

    runMosaicTileVizFrame(steps, 0);
    runMosaicTileVizFrame(steps, 1 / 60);

    expect(runtimes.size).toBe(4);
    for (const rt of runtimes.values()) expect(rt.advanceCount).toBe(2);

    const onlyFirst = steps.filter((s) => s.storeId === "koi-pond:pond-1");
    const pond1 = runtimes.get("koi-pond:pond-1")!;
    const pond2 = runtimes.get("koi-pond:pond-2")!;
    const zBefore = pond1.zoomLog;
    runMosaicTileVizFrame(onlyFirst, 2 / 60);
    expect(pond1.advanceCount).toBe(3);
    expect(pond2.advanceCount).toBe(2);
    expect(pond1.zoomLog).not.toBe(zBefore);
  });
});
