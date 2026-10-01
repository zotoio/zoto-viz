import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { topology, setPluginModes } from "../core/modes";
import { themeById } from "../core/themes";
import { applyPluginCatalog } from "../plugins/plugin";
import { Mosaic } from "./mosaic";
import { RenderHost } from "./render-host";
import { DEFAULT_DREAM, NetScene } from "./scene";

/**
 * QE batch A replay (4a16e10a): while Backrooms' sky was held, all four panes kept `warming`, whose
 * opaque gradient covered the shared render host, so the three host graphs never showed. After a
 * Retry the Backrooms sky landed but its pane stayed warming with fault no-sky, because the only
 * check had already run. Each pane now settles on its own load, and again once its own sky is on it.
 */
const IDS = ["plugin:backrooms", "plugin:talkers", "plugin:load", "plugin:memory"] as const;
const HOST = IDS.slice(1);

function wall() {
  applyPluginCatalog([
    { id: "backrooms", name: "Backrooms", version: 1, engine: "graph", look: { backdrop: "plugin", stageOnly: true, mosaic: "off" } },
    { id: "talkers", name: "Talkers", version: 1, engine: "graph" },
    { id: "load", name: "Load", version: 1, engine: "graph" },
    { id: "memory", name: "Memory", version: 1, engine: "graph" },
  ]);
  setPluginModes(IDS.map((id) => ({ ...topology, id, pluginId: id.slice("plugin:".length), label: id })));
  const wallEl = document.createElement("div");
  Object.defineProperty(wallEl, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wallEl, "clientHeight", { value: 600, configurable: true });
  const sceneEl = document.createElement("div");
  Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
  const host = new RenderHost(wallEl, { software: true });
  const main = new NetScene(sceneEl, { host });
  main.retargetPanel(IDS[0]);
  const anim = { ...DEFAULT_DREAM, mosaicUniqueSkies: true as const };
  const mosaic = new Mosaic({
    wall: wallEl, sceneEl, main, host, arcade: {},
    optsFor: () => ({}), onFocus: () => {}, onPromote: () => {}, onLayout: () => {}, onCloseLast: () => {},
    sync: () => ({
      theme: themeById("midnight"), filters: {}, anim, dreaming: false,
      nodeFilter: () => true, lastMsg: null, aliasMap: new Map(),
    }),
  });
  mosaic.setSize("4", IDS[0], "off", { tiles: [...IDS] });
  const pane = (id: string) => wallEl.querySelector<HTMLElement>(`.mosaic-pane[data-mode="${id}"]`)!;
  return { mosaic, host, pane };
}

describe("mosaic warming clears per pane", () => {
  afterEach(() => { setPluginModes([]); applyPluginCatalog([]); });

  it("a held Backrooms sky keeps only its own pane warming; the three host panes settle on their own loads", () => {
    const { mosaic, host, pane } = wall();
    mosaic.markSkyPending();
    for (const id of IDS) expect(pane(id).classList.contains("warming")).toBe(true);
    // The three host loads end while Backrooms is still held: settlePanes() has not run.
    for (const id of HOST) mosaic.settlePane(id);
    for (const id of HOST) expect(pane(id).classList.contains("warming"), id).toBe(false);
    expect(pane("plugin:backrooms").classList.contains("warming")).toBe(true);
    host.dispose();
  });

  it("after Retry, the pane is checked again once its own sky is on it, and stops warming", () => {
    const { mosaic, host, pane } = wall();
    mosaic.markSkyPending();
    mosaic.settlePanes(); // the sync ends while the retried sky is still loading
    const p = pane("plugin:backrooms");
    expect(p.dataset.fault).toBe("no-sky");
    expect(p.classList.contains("warming")).toBe(true);
    // Retry's sky lands on the tile.
    Object.defineProperty(mosaic.graphScene("plugin:backrooms")!, "pluginSkyId", { get: () => "backrooms", configurable: true });
    mosaic.settlePane("plugin:backrooms");
    expect(p.dataset.fault).toBe("");
    expect(p.classList.contains("warming")).toBe(false);
    host.dispose();
  });

  it("CSS: a glass pane stays transparent while warming, so the gradient never covers the render host", () => {
    const css = readFileSync(resolve(__dirname, "../style.css"), "utf8");
    const warm = css.indexOf(".mosaic-pane.warming {");
    const glassWarm = css.search(/\.mosaic-pane\.glass\.warming\s*\{[^}]*background:\s*transparent/);
    expect(warm).toBeGreaterThan(-1);
    expect(glassWarm).toBeGreaterThan(warm);
  });

  it("wiring: each tile settles in its own load's finally, and an installed pack sky re-checks its pane", () => {
    const main = readFileSync(resolve(__dirname, "../app/main.ts"), "utf8");
    const sync = main.slice(main.indexOf("async function syncPluginSky("), main.indexOf("function teardownMosaicPanelView("));
    expect(sync).toContain("await loadTilesSettlingEach(skyTiles, signal,");
    expect(sync).toMatch(/\(id\) => \{ if \(m\.on\) m\.settlePane\(id\); \}\);/);
    const install = main.slice(main.indexOf("async function installPluginSky("), main.indexOf("const skyWaitTiles"));
    expect(install.indexOf("mosaic.settlePane(paneId)")).toBeGreaterThan(install.indexOf("landWhenDrawn(skyWaits"));
  });
});
