import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mosaic } from "./mosaic";
import { DEFAULT_DREAM } from "./scene";
import type { NetScene } from "./scene";
import { memory, setPluginModes, topology } from "../core/modes";
import * as coalesce from "./mosaic-pack-coalesce";

describe("Mosaic setPaneView", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...memory, id: "plugin:memory", pluginId: "memory", label: "Memory" },
    ]);
  });

  afterEach(() => {
    setPluginModes([]);
    document.body.innerHTML = "";
  });

  function makeMosaic(pluginSpecForMode = () => null): Mosaic {
    const wall = document.createElement("div");
    const sceneEl = document.createElement("div");
    document.body.append(wall, sceneEl);
    const main = {
      setCompactLabels: vi.fn(),
      relayout: vi.fn(),
      setMode: vi.fn(),
      setStageOnly: vi.fn(),
      setActive: vi.fn(),
      viewEl: document.createElement("div"),
      currentTheme: { id: "midnight" },
      currentFilters: {},
      pulseNow: { bass: 0 },
      dreamAnim: DEFAULT_DREAM,
      pluginSkyId: null,
      nodeCount: 0,
      currentMode: { id: "plugin:topology" },
      setAnim: vi.fn(),
    } as unknown as NetScene;
    return new Mosaic({
      wall,
      sceneEl,
      main,
      arcade: {},
      optsFor: () => ({}),
      pluginSpecForMode,
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: main.currentTheme,
        filters: main.currentFilters,
        anim: { ...DEFAULT_DREAM, mosaic: "2", mosaicTiles: ["plugin:topology", "plugin:memory"] },
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
  }

  it("allocates a duplicate slot when picking a view already on another tile", () => {
    const m = makeMosaic();
    m.setSize("2", "plugin:star-sines", "off", {
      tiles: ["plugin:topology", "plugin:memory"],
    });
    expect(m.setPaneView("plugin:memory", "plugin:topology")).toBe(true);
    expect(m.tileIds).toEqual(["plugin:topology", "plugin:topology!1"]);
  });

  it("passes pluginSpecForMode into pack coalesce after pane view change", () => {
    const specSpy = vi.fn(() => ({
      id: "topology",
      viz: { maxBuffers: 1, maxBufferFloats: 16, maxParticles: 0, uniforms: [] },
    }));
    const layoutSpy = vi.spyOn(coalesce, "applyPackCoalesceLayout").mockImplementation(() => {});
    const m = makeMosaic(specSpy as never);
    m.setSize("2", "plugin:topology", "off", {
      tiles: ["plugin:topology", "plugin:memory"],
    });
    m.setPaneView("plugin:memory", "plugin:topology");
    expect(layoutSpy).toHaveBeenCalled();
    const passed = layoutSpy.mock.calls.at(-1)?.[0] as { cfg: { pluginSpecForMode?: (id: string) => unknown } };
    expect(passed.cfg.pluginSpecForMode?.("plugin:topology")).toEqual(specSpy.mock.results[0]?.value);
    layoutSpy.mockRestore();
  });
});
