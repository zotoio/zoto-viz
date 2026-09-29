/**
 * `picker: hidden` (plugin.yml): the 7 shipped test / fixture packs never show in a picker and
 * never come up in a random or cruise pick, but they still open by id. Catalog rows are built
 * from the shipped plugin.yml + visualisation.yml on disk, the way the service merges them.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { allModes, modeById } from "../core/modes";
import { shuffleLook } from "../core/shuffle";
import { mosaicPanePool } from "../graph/mosaic";
import { pickPaneDiceView } from "../graph/pane-dice";
import { applyPluginCatalog, dreamCycleModes, fillViewSelect, isPickerHidden, viewSelectOptions, type PluginView } from "./plugin";
import { toPluginView } from "./plugin-visualisation";
import type { ProfileSettings } from "../core/profiles";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HIDDEN = [
  "host-mesh-demo", "sandbox-fixture-multi", "tile-health-black", "tile-health-detail",
  "tile-health-lose-ctx", "tile-health-stall", "tile-health-static",
];

/** Shipped catalog rows from disk; `stripPicker` gives the catalog as it was before `picker:`. */
function shippedCatalog(stripPicker = false): PluginView[] {
  const src = path.join(repoRoot, "plugins/src");
  const out: PluginView[] = [];
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const home = path.join(src, dir.name);
    const yml = path.join(home, "plugin.yml");
    if (!existsSync(yml)) continue;
    const doc = parse(readFileSync(yml, "utf8")) as Record<string, unknown>;
    if (doc.kind === "data-source") continue;
    const vizFile = path.join(home, "visualisation.yml");
    const viz = existsSync(vizFile) ? parse(readFileSync(vizFile, "utf8")) as Record<string, unknown> : {};
    const row: Record<string, unknown> = { ...doc, origin: "src", visualisation: viz ?? {} };
    if (stripPicker) delete row.picker;
    out.push(toPluginView(row));
  }
  return out;
}

function packOf(viewId: string): string {
  return modeById(viewId).pluginId ?? viewId;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("picker: hidden — the 7 fixture packs", () => {
  afterEach(() => { applyPluginCatalog([]); });

  it("the 7 shipped fixture packs carry picker: hidden, and only they do", () => {
    const hidden = shippedCatalog().filter((p) => p.picker === "hidden").map((p) => p.id).sort();
    expect(hidden).toEqual(HIDDEN);
  });

  it("(a) the picker lists 0 of the 7", () => {
    applyPluginCatalog(shippedCatalog());
    const listed = viewSelectOptions().filter((o) => HIDDEN.includes(packOf(o.value))).map((o) => o.value);
    expect(listed).toEqual([]);
    const sel = document.createElement("select");
    fillViewSelect(sel, "plugin:topology");
    const inPane = [...sel.options].filter((o) => HIDDEN.includes(packOf(o.value))).map((o) => o.value);
    expect(inPane, "mosaic pane pickers list none either").toEqual([]);
  });

  it("(b) pick-every-view: 70 view packs before, 63 after (picker rows drop by the 7 as well)", () => {
    applyPluginCatalog(shippedCatalog(true));
    const beforeRows = viewSelectOptions().length;
    const beforePacks = new Set(viewSelectOptions().map((o) => packOf(o.value))).size;
    applyPluginCatalog(shippedCatalog());
    const afterRows = viewSelectOptions().length;
    const afterPacks = new Set(viewSelectOptions().map((o) => packOf(o.value))).size;
    expect({ beforePacks, afterPacks, dropped: beforeRows - afterRows }).toEqual({ beforePacks: 70, afterPacks: 63, dropped: 7 });
    expect(allModes().filter((m) => HIDDEN.includes(m.pluginId ?? "")).length, "still in the catalog").toBe(7);
  });

  it("(c) 1000 seeded random draws (dice view, pane dice, new-wall pool, dream cycle): 0 hidden picks", () => {
    applyPluginCatalog(shippedCatalog());
    const rnd = seeded(183);
    const pickerIds = viewSelectOptions().map((o) => o.value);
    const pool = mosaicPanePool();
    const cycle = dreamCycleModes().map((m) => m.id);
    const base = { mode: "plugin:topology", dice: { include: { view: true } } } as unknown as ProfileSettings;
    const hits: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const dice = shuffleLook(base, { themes: ["dark"], modes: pickerIds.map((id) => ({ id })), plugins: [], skies: [], audioDrives: [] }, rnd).mode;
      const pane = pickPaneDiceView("plugin:topology", ["plugin:topology"], pickerIds, () => false, rnd);
      const wall = pool[Math.floor(rnd() * pool.length)]!;
      const cruise = cycle[i % cycle.length]!;
      for (const id of [dice, pane, wall, cruise]) if (id && isPickerHidden(id)) hits.push(id);
    }
    expect(hits).toEqual([]);
    expect(pool.some((id) => isPickerHidden(id)), "new-wall pool").toBe(false);
    expect(cycle.some((id) => isPickerHidden(id)), "dream cycle").toBe(false);
  });

  it("(d) a hidden pack still opens by id, and a select running it names it", () => {
    applyPluginCatalog(shippedCatalog());
    for (const id of HIDDEN) {
      const m = modeById(`plugin:${id}`);
      expect(m.id, id).toBe(`plugin:${id}`);
      expect(isPickerHidden(m.id)).toBe(true);
    }
    const sel = document.createElement("select");
    fillViewSelect(sel, "plugin:tile-health-black");
    expect(sel.value).toBe("plugin:tile-health-black");
    expect(sel.selectedOptions[0]?.textContent).toMatch(/Tile health/);
  });
});
