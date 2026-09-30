import { afterEach, describe, expect, it } from "vitest";
import { setPluginModes, talkers, topology } from "../core/modes";
import { fillViewSelect, viewSelectOptions } from "./plugin";
import {
  noteUserView,
  recentViewIds,
  resetRecentViewsForTests,
  setRecentViews,
} from "./recent-views";

afterEach(() => {
  resetRecentViewsForTests();
  setPluginModes([]);
});

describe("recent views", () => {
  it("keeps the ten newest user picks, most recent first", () => {
    for (let i = 0; i < 12; i++) noteUserView(`plugin:v${i}`);
    expect(recentViewIds()).toEqual([
      "plugin:v11", "plugin:v10", "plugin:v9", "plugin:v8", "plugin:v7",
      "plugin:v6", "plugin:v5", "plugin:v4", "plugin:v3", "plugin:v2",
    ]);
    noteUserView("plugin:v4");
    expect(recentViewIds()[0]).toBe("plugin:v4");
    expect(recentViewIds()).toHaveLength(10);
    expect(noteUserView("plugin:v4")).toBe(false);
    expect(noteUserView("__pack_blocked_catalog__")).toBe(false);
    expect(noteUserView("plugin:heat!2")).toBe(true);
    expect(recentViewIds()[0]).toBe("plugin:heat");
  });

  it("pins those views at the top of the catalog menus", () => {
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
    ]);
    setRecentViews(["plugin:talkers", "plugin:missing", "plugin:topology"]);
    const opts = viewSelectOptions();
    expect(opts[0]).toMatchObject({ value: "plugin:talkers", group: "recent", hint: "1" });
    expect(opts[1]).toMatchObject({ value: "plugin:topology", group: "recent", hint: "2" });
    expect(opts.filter((o) => o.value === "plugin:talkers")).toHaveLength(1);
    expect(opts.find((o) => o.group === "graph")?.value).not.toBe("plugin:talkers");
    const sel = document.createElement("select");
    fillViewSelect(sel, "plugin:topology");
    expect(sel.querySelector("optgroup")?.label).toBe("recent");
    const first = sel.querySelector<HTMLOptionElement>("option");
    expect(first?.textContent).toMatch(/Talkers/);
    expect(first?.selected).toBe(false);
    expect(sel.querySelector<HTMLOptionElement>("option[value='plugin:topology']")?.selected).toBe(true);
  });
});
