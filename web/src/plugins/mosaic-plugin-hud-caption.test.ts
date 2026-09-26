import { describe, expect, it } from "vitest";
import { applyPresetToValues } from "./plugin-settings";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { syncMosaicPluginCaptions } from "./plugin-hud-sync";
import type { PluginView } from "./plugin";
import { Mosaic } from "../graph/mosaic";

function hudPack(id: string, name: string): PluginView {
  return { ...loadSettingsDeclFixture(), id, name };
}

describe("mosaic per-tile settings captions", () => {
  it("renders each pack caption inside its own tile element on a 2-tile wall", () => {
    const wall = document.createElement("div");
    const mosaic = new Mosaic({
      wall,
      sceneEl: document.createElement("div"),
      main: { currentMode: { id: "plugin:pack-a" }, setCompactLabels: () => {}, relayout: () => {}, setMode: () => {} } as never,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: { id: "midnight" } as never,
        filters: {},
        anim: {} as never,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });

    const tileA = document.createElement("div");
    const tileB = document.createElement("div");
    tileA.className = "mosaic-pane";
    tileB.className = "mosaic-pane";
    wall.append(tileA, tileB);
    const panes = mosaic as unknown as { panes: Map<string, HTMLElement> };
    panes.panes.set("plugin:pack-a", tileA);
    panes.panes.set("plugin:pack-b", tileB);

    const specA = hudPack("pack-a", "AIR SSIDs");
    const specB = hudPack("pack-b", "Koi Pond");
    const fields = loadSettingsDeclFixture().config ?? [];
    const optsA: Record<string, string> = {};
    const optsB: Record<string, string> = {};
    applyPresetToValues(specA, fields, optsA, "a");
    applyPresetToValues(specB, fields, optsB, "b");

    const captions = new Map<string, string | null>([
      ["plugin:pack-a", "X · Alpha"],
      ["plugin:pack-b", "X · Alpha"],
    ]);

    syncMosaicPluginCaptions(
      {
        on: true,
        tileIds: ["plugin:pack-a", "plugin:pack-b"],
        setPaneSettingsCaption: (id, text) => mosaic.setPaneSettingsCaption(id, text),
      },
      captions,
      (tileId) => {
        if (tileId === "plugin:pack-a") {
          return { mode: { id: tileId, pluginId: "pack-a", label: "AIR" }, spec: specA, opts: optsA, fields };
        }
        if (tileId === "plugin:pack-b") {
          return { mode: { id: tileId, pluginId: "pack-b", label: "Koi" }, spec: specB, opts: optsB, fields };
        }
        return null;
      },
    );

    const capA = tileA.querySelector(".mosaic-pane-settings-caption");
    const capB = tileB.querySelector(".mosaic-pane-settings-caption");
    expect(capA?.textContent).toBe("AIR SSIDs · X · Alpha");
    expect(capB?.textContent).toBe("Koi Pond · Y · Bravo");
    expect(tileA.contains(capB!)).toBe(false);
    expect(tileB.contains(capA!)).toBe(false);
  });
});
