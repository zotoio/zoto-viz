import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mosaic } from "./mosaic";
import { DEFAULT_DREAM } from "./scene";
import type { NetScene } from "./scene";
import { memory, setPluginModes, topology } from "../core/modes";
import * as coalesce from "./mosaic-pack-coalesce";

describe("Mosaic pluginSpecForMode cfg", () => {
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

  it("forwards pluginSpecForMode into pack coalesce after pane view change", () => {
    const specSpy = vi.fn(() => ({
      id: "topology",
      viz: { maxBuffers: 1, maxBufferFloats: 16, maxParticles: 0, uniforms: [] },
    }));
    const layoutSpy = vi.spyOn(coalesce, "applyPackCoalesceLayout").mockImplementation(() => {});
    const wall = document.createElement("div");
    const sceneEl = document.createElement("div");
    document.body.append(wall, sceneEl);
    const main = {
      setCompactLabels: vi.fn(),
      relayout: vi.fn(),
      setMode: vi.fn(),
      setStageOnly: vi.fn(),
      setActive: vi.fn(),
      setAnim: vi.fn(),
      viewEl: document.createElement("div"),
      currentTheme: { id: "midnight" },
      currentFilters: {},
      pulseNow: { bass: 0 },
      dreamAnim: DEFAULT_DREAM,
      pluginSkyId: null,
      nodeCount: 0,
      currentMode: { id: "plugin:topology" },
    } as unknown as NetScene;
    const m = new Mosaic({
      wall,
      sceneEl,
      main,
      arcade: {},
      optsFor: () => ({}),
      pluginSpecForMode: specSpy as never,
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
    m.setSize("2", "plugin:topology", "off", { tiles: ["plugin:topology", "plugin:memory"] });
    m.setPaneView("plugin:memory", "plugin:topology");
    expect(layoutSpy).toHaveBeenCalled();
    const passed = layoutSpy.mock.calls.at(-1)?.[0] as { cfg: { pluginSpecForMode?: (id: string) => unknown } };
    expect(passed.cfg.pluginSpecForMode?.("plugin:topology")).toEqual(specSpy.mock.results[0]?.value);
    layoutSpy.mockRestore();
  });
});
