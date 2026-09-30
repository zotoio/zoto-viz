/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { lookForMode } from "../plugins/plugin";
import { Settings } from "../ui/settings";
import { setPluginModes, talkers, topology, type ViewMode } from "../core/modes";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "../plugins/plugin";
import { mockPartial } from "../../test-support/mock-partial";
import {
  agentPatchTilesWhenViewOffWall,
  bindMosaicHostSettings,
  modeIdForMosaicPluginChange,
  mosaicFocusSlotForMode,
  mosaicModeAlreadyOnWall,
  mosaicPanePickFocusSlot,
  mosaicPluginSkyPaneView,
  shouldTickVizHudForFeed,
} from "./mosaic-host-bindings";

describe("mosaic host bindings", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("modeIdForMosaicPluginChange strips duplicate tile slot suffix", () => {
    expect(modeIdForMosaicPluginChange("plugin:topology!2")).toBe("plugin:topology");
  });

  it("mosaicPanePickFocusSlot focuses the slot that already shows the view id", () => {
    const tiles = ["plugin:b", "plugin:a!1"];
    expect(mosaicPanePickFocusSlot(tiles, "plugin:a", "plugin:b")).toBe("plugin:a!1");
  });

  it("mosaicFocusSlotForMode picks the duplicate slot carrying the mode id", () => {
    const tiles = ["plugin:y", "plugin:x!1"];
    expect(mosaicFocusSlotForMode(tiles, "plugin:x", "plugin:y")).toBe("plugin:x!1");
  });

  it("mosaicModeAlreadyOnWall treats duplicate pack slots as on-wall", () => {
    expect(mosaicModeAlreadyOnWall(["plugin:pack!1", "plugin:other"], "plugin:pack")).toBe(true);
    expect(mosaicModeAlreadyOnWall(["plugin:pack!1", "plugin:other"], "plugin:missing")).toBe(false);
  });

  it("agentPatchTilesWhenViewOffWall rewrites focused tile when view is not placed", () => {
    const next = agentPatchTilesWhenViewOffWall(["plugin:a", "plugin:b"], "plugin:b", "plugin:c");
    expect(next).toEqual(["plugin:a", "plugin:c"]);
  });

  it("agentPatchTilesWhenViewOffWall skips when duplicate slot already shows the view", () => {
    expect(agentPatchTilesWhenViewOffWall(["plugin:a!1", "plugin:b"], "plugin:a!1", "plugin:a")).toBeNull();
  });

  it("shouldTickVizHudForFeed is false while mosaic is on", () => {
    expect(shouldTickVizHudForFeed(true)).toBe(false);
    expect(shouldTickVizHudForFeed(false)).toBe(true);
  });

  it("mosaicPluginSkyPaneView strips slot suffix before sky lookup", () => {
    expect(mosaicPluginSkyPaneView("plugin:topology!2", "plugin", lookForMode).viewId).toBe("plugin:topology");
  });

  it("mosaicPluginSkyPaneView still wants a plugin sky when a host sky was stored on the tile", () => {
    const look = (id: string) => (id === "plugin:aquarium" ? { backdrop: "plugin" as const } : undefined);
    expect(mosaicPluginSkyPaneView("plugin:aquarium", "lagoon", look).wantPlugin).toBe(true);
    expect(mosaicPluginSkyPaneView("plugin:aquarium!1", "space", look).wantPlugin).toBe(true);
    expect(mosaicPluginSkyPaneView("plugin:topology", "fire", look).wantPlugin).toBe(false);
  });

  it("bindMosaicHostSettings wires pane pick to focus duplicate slot after setPaneView", () => {
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
      { ...topology, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
    ]);
    const focus = vi.fn();
    const setPaneView = vi.fn(() => true);
    const mosaic = {
      on: true,
      tileIds: ["plugin:talkers", "plugin:topology!1"],
      focusedId: "plugin:talkers",
      setPaneView,
      focus,
      graphScene: () => ({ setMode: vi.fn() }),
    };
    const settings = new Settings({ storePrefix: "zoto-viz-bindings-pick", onChange: () => {} });
    bindMosaicHostSettings(settings, {
      getMosaic: () => mosaic as never,
      modeById: (id) => ({ id, pluginId: id.slice(7), label: id, standalone: false }) as never,
      optsFor: () => ({}),
      pluginSpecForMode: () => null,
      ensureReviewed: async () => true,
      skySpecForMode: () => null,
      syncPluginSky: async () => {},
      arcadeSlotFor: () => null,
    });
    expect(settings.onMosaicPanePick!("plugin:talkers", "plugin:topology")).toBe(true);
    expect(setPaneView).toHaveBeenCalledWith("plugin:talkers", "plugin:topology");
    expect(focus).toHaveBeenCalledWith("plugin:topology!1");
    setPluginModes([]);
  });

  it("bindMosaicHostSettings onPluginChange uses pack view id for duplicate focus slot", () => {
    const setMode = vi.fn();
    const mosaic = {
      on: true,
      focusedId: "plugin:topology!2",
      graphScene: () => ({ setMode }),
    };
    const settings = new Settings({ storePrefix: "zoto-viz-bindings-plugin", onChange: () => {} });
    bindMosaicHostSettings(settings, {
      getMosaic: () => mosaic as never,
      modeById: (id) => ({ id, pluginId: "topology", label: "T" }) as never,
      optsFor: () => ({ k: "v" }),
      pluginSpecForMode: () => null,
      ensureReviewed: async () => true,
      skySpecForMode: () => null,
      syncPluginSky: async () => {},
      arcadeSlotFor: () => null,
    });
    settings.onPluginChange!();
    expect(setMode).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plugin:topology" }),
      { k: "v" },
    );
  });

  it("pane pick whose sky sync rejects: the rejection is caught (no unhandled rejection), the pane keeps the pick (#171 c)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const setPaneView = vi.fn(() => true);
      const focus = vi.fn();
      const mosaic = mockPartial<Mosaic>({ on: true, tileIds: ["plugin:talkers", "plugin:topology"], setPaneView, focus });
      const spec = mockPartial<PluginView>({ id: "topology", name: "Topology", version: 1 });
      // The pane's pack sky fails (a compile error or a failed fetch): installPluginSky logs it and rejects.
      // A plain function, not vi.fn: a spy tracks settled results, which would itself handle the rejection.
      const synced: (PluginView | null)[] = [];
      const syncPluginSky = async (s: PluginView | null): Promise<void> => {
        synced.push(s);
        throw new Error("shader failed");
      };
      const settings = new Settings({ storePrefix: "zoto-viz-bindings-reject", onChange: () => {} });
      bindMosaicHostSettings(settings, {
        getMosaic: () => mosaic,
        modeById: (id) => mockPartial<ViewMode>({ id, pluginId: id.slice(7), label: id, standalone: false }),
        optsFor: () => ({}),
        pluginSpecForMode: () => spec,
        ensureReviewed: async () => true,
        skySpecForMode: (_id, fb) => fb,
        syncPluginSky,
        arcadeSlotFor: () => null,
      });
      expect(settings.onMosaicPanePick!("plugin:talkers", "plugin:topology")).toBe(true);
      await vi.waitFor(() => expect(synced).toEqual([spec]));
      // Node reports an unhandled rejection after the microtask queue drains: give it two macrotasks.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled.map(String), "unhandled rejections from the pane pick's sky sync").toEqual([]);
      expect(setPaneView).toHaveBeenCalledWith("plugin:talkers", "plugin:topology");
      expect(focus).toHaveBeenCalledWith("plugin:topology");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      setPluginModes([]);
    }
  });
});
