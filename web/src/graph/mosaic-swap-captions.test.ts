import { describe, expect, it, vi } from "vitest";
import { applyPresetToValues } from "../plugins/plugin-settings";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { syncMosaicPluginCaptions } from "../plugins/plugin-hud-sync";
import { hostModeById } from "../app/host-mode";
import type { PluginView } from "../plugins/plugin";
import { assignTiles } from "./mosaic-layout";
import { Mosaic } from "./mosaic";

function hudPack(id: string, name: string): PluginView {
  return { ...loadSettingsDeclFixture(), id, name };
}

describe("mosaic pane swap > captions follow view slot ids", () => {
  it("keeps each caption on its own view after swap on the next frame", async () => {
    const wall = document.createElement("div");
    const mosaic = new Mosaic({
      wall,
      sceneEl: document.createElement("div"),
      main: {
        currentMode: { id: "plugin:pack-a" },
        setCompactLabels: () => {},
        relayout: () => {},
        setMode: () => {},
        setAnim: () => {},
      } as never,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: { id: "midnight" } as never,
        filters: {},
        anim: { backdrop: "space" } as never,
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
    Object.assign(mosaic, {
      size: "2",
      tree: {
        type: "split",
        dir: "h",
        ratio: 0.5,
        a: { type: "leaf", id: "plugin:pack-a" },
        b: { type: "leaf", id: "plugin:pack-b" },
      },
    });

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
          return { mode: hostModeById(tileId), spec: specA, opts: optsA, fields };
        }
        if (tileId === "plugin:pack-b") {
          return { mode: hostModeById(tileId), spec: specB, opts: optsB, fields };
        }
        return null;
      },
    );
    expect(mosaic.captionForTile("plugin:pack-a")).toBe("AIR SSIDs · X · Alpha");
    expect(mosaic.captionForTile("plugin:pack-b")).toBe("Koi Pond · Y · Bravo");

    const internal = mosaic as unknown as {
      tree: object;
      placeTree(): void;
      repaintAllCaptions(): void;
    };
    internal.tree = assignTiles(internal.tree as never, ["plugin:pack-b", "plugin:pack-a"]);
    internal.placeTree();
    internal.repaintAllCaptions();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    expect(mosaic.captionForTile("plugin:pack-a")).toBe("AIR SSIDs · X · Alpha");
    expect(mosaic.captionForTile("plugin:pack-b")).toBe("Koi Pond · Y · Bravo");
    expect(tileA.querySelector(".mosaic-pane-settings-caption")?.textContent).toBe("AIR SSIDs · X · Alpha");
    expect(tileB.querySelector(".mosaic-pane-settings-caption")?.textContent).toBe("Koi Pond · Y · Bravo");
  });
});
