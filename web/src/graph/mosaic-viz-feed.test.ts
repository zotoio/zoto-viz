import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverMosaicDemoPacks, dropMosaicTileWriter } from "./mosaic-viz-feed";
import { modeById, setPluginModes, talkers, topology } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM } from "./scene";
import type { VizDataFrame } from "../plugins/viz-host";

describe("deliverMosaicDemoPacks", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("writes UBO to each tile's scene", () => {
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
    const frame: VizDataFrame = {
      t: 1,
      dt: 0,
      audio: 0.2,
      packets: [{ proto: "TCP", size: 0, field: 0 }],
      talkers: [{ id: "b", rate: 20, role: "lan" }],
      rf: [],
      headlines: [],
    };
    deliverMosaicDemoPacks(
      mosaic as never,
      frame,
      modeById,
      (id) => ({ id: id.replace("plugin:", ""), viz: { maxBuffers: 1, maxBufferFloats: 32, maxParticles: 0, uniforms: [] } }) as never,
      () => ({}),
    );
    expect(uboByTile.has("plugin:star-sines")).toBe(true);
    expect(uboByTile.has("plugin:kefrens-bars")).toBe(true);
    expect(uboByTile.get("plugin:star-sines")!.length).toBe(512);
    expect(uboByTile.get("plugin:kefrens-bars")!.length).toBe(512);
    expect(Array.from(uboByTile.get("plugin:star-sines")!).some((v) => v !== 0)).toBe(true);
    expect(Array.from(uboByTile.get("plugin:kefrens-bars")!).some((v) => v !== 0)).toBe(true);
    const sines = uboByTile.get("plugin:star-sines")!;
    const kef = uboByTile.get("plugin:kefrens-bars")!;
    expect(Array.from(sines).join(",")).not.toBe(Array.from(kef).join(","));
    dropMosaicTileWriter("plugin:star-sines");
  });
});

describe("mosaic onPanePick wiring", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("invokes live hook instead of bare setPaneView", async () => {
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
    ]);
    const { Mosaic } = await import("./mosaic");
    const { RenderHost } = await import("./render-host");
    const { NetScene } = await import("./scene");
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel("plugin:topology");
    const diceCalls: string[] = [];
    const pickCalls: [string, string][] = [];
    const pick = vi.fn(async (from: string, to: string) => {
      pickCalls.push([from, to]);
      return true;
    });
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
      paneDice: (id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mosaic-pane-dice";
        b.dataset.pane = id;
        b.addEventListener("click", () => diceCalls.push(id));
        return b;
      },
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
    mosaic.setSize("4", "plugin:topology", "off", { tiles: ["plugin:topology", "plugin:wifi"] });
    const pane = wall.querySelector<HTMLSelectElement>(".mosaic-pick");
    expect(pane).toBeTruthy();
    pane!.value = "plugin:wifi";
    pane!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(pickCalls).toEqual([["plugin:topology", "plugin:wifi"]]);
    const dice = wall.querySelectorAll<HTMLButtonElement>(".mosaic-pane-dice");
    expect(dice.length).toBe(2);
    dice[0]!.click();
    expect(diceCalls).toEqual(["plugin:topology"]);
    host.dispose();
    main.dispose();
  });
});
