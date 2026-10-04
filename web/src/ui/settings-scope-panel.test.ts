/** Scope control, breadcrumb, field status, reset, tile names, one announcement, keyboard. */
import { describe, expect, it } from "vitest";
import { emptyScopeStore, resolve } from "../core/settings-scope";
import {
  defaultScopeLevel,
  fieldStatusText,
  resetFieldName,
  SettingsScopePanel,
  settingsForTileLabel,
} from "./settings-scope-panel";

describe("settings scope panel", () => {
  it("each entry point opens on its default level", () => {
    expect(defaultScopeLevel("global")).toBe("global");
    expect(defaultScopeLevel("view")).toBe("view");
    expect(defaultScopeLevel("tile")).toBe("tile");
    expect(new SettingsScopePanel({ entry: "global" }).level).toBe("global");
    expect(new SettingsScopePanel({ entry: "view", viewName: "Koi Pond · Night" }).level).toBe("view");
    expect(new SettingsScopePanel({ entry: "tile", tileIndex: 3, packName: "Koi Pond" }).level).toBe("tile");
  });

  it("an edit at Tile writes only the tile, and Global is unchanged", () => {
    const panel = new SettingsScopePanel({ entry: "tile", tileIndex: 3, packName: "Koi Pond", viewName: "Koi Pond · Night" });
    const store = panel.write(emptyScopeStore(), "theme", "aurora");
    expect(store.global.theme).toBeUndefined();
    expect(store.tile["tile-3"]?.theme).toBe("aurora");
  });

  it("reset deletes the override and the status names the inherited level", () => {
    const panel = new SettingsScopePanel({ entry: "tile", tileIndex: 3, packName: "Koi Pond" });
    let store = emptyScopeStore();
    store = { ...store, global: { theme: "midnight" } };
    store = panel.write(store, "theme", "aurora");
    const reset = panel.reset(store, "theme");
    expect(resolve(reset.store, "theme", {
      packId: "Koi Pond", viewId: "", wallId: "default", tileId: "tile-3",
    })).toBe("midnight");
    expect(reset.status).toBe(fieldStatusText({ setHere: false, fromLevel: "Global", fromValue: "midnight" }));
    expect(reset.name).toBe(resetFieldName("theme", "Global", "midnight"));
  });

  it("tile cog names are distinct for 8 tiles", () => {
    const names = Array.from({ length: 8 }, (_, i) => settingsForTileLabel(i + 1, "Koi Pond"));
    expect(new Set(names).size).toBe(8);
    expect(names[2]).toBe("Settings for tile 3: Koi Pond");
  });

  it("a scope change is announced once", () => {
    const panel = new SettingsScopePanel({ entry: "tile", tileIndex: 3, packName: "Koi Pond" });
    panel.select("global");
    panel.select("global");
    expect(panel.announcementCount).toBe(1);
    expect(panel.polite.textContent).toBe("Editing Global. Changes apply everywhere.");
  });

  it("a field status is text the control describes, and the pack sentence sits beside the control", () => {
    const panel = new SettingsScopePanel({ entry: "tile", tileIndex: 3, packName: "Koi Pond" });
    expect(panel.el.textContent).toContain("Applies to all Koi Pond tiles");
    expect(panel.el.textContent).toContain("Separate this tile");
    const row = document.createElement("div");
    row.innerHTML = `<button type="button">preset</button>`;
    panel.attachField(row, "preset", "Set here", "Reset preset to Global value, zen");
    const btn = row.querySelector("button")!;
    expect(btn.getAttribute("aria-describedby")).toBe(row.querySelector(".settings-scope-status")?.id);
    expect(row.querySelector(".settings-scope-status")?.textContent).toBe("Set here");
    expect(row.querySelector(".settings-scope-reset")?.getAttribute("aria-label")).toBe("Reset preset to Global value, zen");
  });

  it("arrow, Home and End move the scope control", () => {
    const panel = new SettingsScopePanel({ entry: "tile", tileIndex: 3, packName: "Koi Pond", viewName: "Night" });
    const tabs = panel.el.querySelector<HTMLElement>('[role="tablist"]')!;
    tabs.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(panel.level).toBe("tile");
    tabs.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(panel.level).toBe("global");
    tabs.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(panel.level).toBe("wall");
  });
});
