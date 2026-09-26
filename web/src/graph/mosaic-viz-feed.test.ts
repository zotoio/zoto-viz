import { describe, expect, it, vi } from "vitest";
import { deliverMosaicDemoPacks, dropMosaicTileWriter, resetMosaicTileWriters } from "./mosaic-viz-feed";
import { modeById, setPluginModes, talkers, topology } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM } from "./scene";
import type { VizDataFrame } from "../plugins/viz-host";

describe("deliverMosaicDemoPacks", () => {
  it("writes UBO to each tile's scene", () => {
    resetMosaicTileWriters();
    setPluginModes([
      { ...topology, id: "plugin:star-sines", pluginId: "star-sines", label: "Sines" },
      { ...talkers, id: "plugin:kefrens-bars", pluginId: "kefrens-bars", label: "Kefrens" },
    ]);
    const uboByTile = new Map<string, Float32Array>();
    const mosaic = {
      tileIds: ["plugin:star-sines", "plugin:kefrens-bars"],
      graphScene: (id: string) => ({
        setPluginUboBuffer: (buf: Float32Array) => {
          uboByTile.set(id, buf);
        },
        setPluginUniform: () => true,
      }),
    };
    const frame = {
      t: 1,
      audio: 0.2,
      packets: [{ id: "a", rate: 10, role: "lan" }],
      talkers: [{ id: "b", rate: 20, role: "lan" }],
      rf: [],
      headlines: [],
    } as VizDataFrame;
    deliverMosaicDemoPacks(
      mosaic as never,
      frame,
      modeById,
      (id) => ({ id: id.replace("plugin:", ""), viz: { maxBuffers: 1, maxBufferFloats: 32, maxParticles: 0, uniforms: [] } }) as never,
      () => ({}),
    );
    expect(uboByTile.has("plugin:star-sines")).toBe(true);
    expect(uboByTile.has("plugin:kefrens-bars")).toBe(true);
    for (const [id, buf] of uboByTile) {
      expect(buf.length, id).toBeGreaterThan(0);
      expect(Array.from(buf).some((v) => v !== 0), `${id} pack UBO is all zero`).toBe(true);
    }
    const sines = uboByTile.get("plugin:star-sines")!;
    const kef = uboByTile.get("plugin:kefrens-bars")!;
    expect(Array.from(sines).join(",")).not.toBe(Array.from(kef).join(","));
    dropMosaicTileWriter("plugin:star-sines");
  });
});

describe("mosaic onPanePick wiring", () => {
  it("invokes live hook instead of bare setPaneView", async () => {
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
    ]);
    const { Mosaic } = await import("./mosaic");
    const { RenderHost } = await import("./render-host");
    const { NetScene, DEFAULT_DREAM } = await import("./scene");
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel("plugin:topology");
    const pick = vi.fn(async () => true);
    const mosaic = new Mosaic({
      wall,
      sceneEl,
      main,
      host,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      onPanePick: pick,
      sync: () => ({
        theme: themeById("midnight"),
        filters: {},
        anim: DEFAULT_DREAM,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.setSize("2", "plugin:topology", "off", { tiles: ["plugin:topology", "plugin:wifi"] });
    const pane = wall.querySelector<HTMLSelectElement>(".mosaic-pick");
    expect(pane).toBeTruthy();
    pane!.value = "plugin:wifi";
    pane!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(pick).toHaveBeenCalledWith("plugin:topology", "plugin:wifi");
    host.dispose();
    main.dispose();
  });
});
