import { afterEach, describe, expect, it } from "vitest";
import { topology, setPluginModes } from "../core/modes";
import { themeById } from "../core/themes";
import { applyPluginCatalog } from "../plugins/plugin";
import { Mosaic } from "./mosaic";
import { RenderHost } from "./render-host";
import { DEFAULT_DREAM, NetScene } from "./scene";

const BUILT_IN = new Set(["fractal", "space", "matrix", "rain"]);

/**
 * Backrooms on a mosaic showed matrix rain: its sky was still compiling (or waiting on consent)
 * when the pane audit ran, so the pane got the first unused built-in sky. A profile per-pane
 * entry (`plugin:backrooms: rain`) must not win over the pack's own look either.
 */
function wall(ids: readonly string[], skies: Record<string, string>) {
  setPluginModes(ids.map((id) => ({ ...topology, id, pluginId: id.slice("plugin:".length), label: id })));
  const wallEl = document.createElement("div");
  Object.defineProperty(wallEl, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wallEl, "clientHeight", { value: 600, configurable: true });
  const sceneEl = document.createElement("div");
  Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
  const host = new RenderHost(wallEl, { software: true });
  const main = new NetScene(sceneEl, { host });
  main.retargetPanel(ids[0]!);
  const anim = { ...DEFAULT_DREAM, mosaicUniqueSkies: true as const, mosaicSkies: skies as never };
  const mosaic = new Mosaic({
    wall: wallEl, sceneEl, main, host, arcade: {},
    optsFor: () => ({}), onFocus: () => {}, onPromote: () => {}, onLayout: () => {}, onCloseLast: () => {},
    sync: () => ({
      theme: themeById("midnight"), filters: {}, anim, dreaming: false,
      nodeFilter: () => true, lastMsg: null, aliasMap: new Map(),
    }),
  });
  mosaic.setSize(String(ids.length) as "2", ids[0], "off", { tiles: [...ids] });
  return { mosaic, host };
}

describe("mosaic pack-sky pane never gets a built-in stand-in", () => {
  afterEach(() => { setPluginModes([]); applyPluginCatalog([]); });

  for (const profileEntry of [undefined, "rain", "matrix"] as const) {
    it(`Backrooms pane keeps the theme background while its sky is not ready (profile entry: ${profileEntry ?? "none"})`, () => {
      applyPluginCatalog([
        { id: "backrooms", name: "Backrooms", version: 1, engine: "graph", look: { backdrop: "plugin", stageOnly: true, mosaic: "off" } },
        { id: "talkers", name: "Talkers", version: 1, engine: "graph" },
      ]);
      const ids = ["plugin:talkers", "plugin:backrooms"] as const;
      const skies: Record<string, string> = { "plugin:talkers": "space" };
      if (profileEntry) skies["plugin:backrooms"] = profileEntry;
      const { mosaic, host } = wall(ids, skies);

      mosaic.markSkyPending();
      mosaic.settlePanes(); // shader never landed: compile still running, or consent wait

      const pane = mosaic.graphScene("plugin:backrooms");
      expect(mosaic.paneSky("plugin:backrooms")).toBe("plugin");
      expect(pane?.dreamAnim.backdrop).toBe("plugin");
      expect(pane?.builtInSkyShown).toBeNull();
      expect(BUILT_IN.has(String(mosaic.layout.skies?.["plugin:backrooms"]))).toBe(false);
      // A pane without a pack sky still gets its host sky.
      expect(mosaic.paneSky("plugin:talkers")).toBe("space");
      host.dispose();
    });
  }
});
