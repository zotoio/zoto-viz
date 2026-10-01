import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import { setPluginModes, topology } from "../core/modes";
import { themeById } from "../core/themes";
import { Mosaic } from "../graph/mosaic";
import { RenderHost } from "../graph/render-host";
import { DEFAULT_DREAM, NetScene } from "../graph/scene";
import { loadShippedPackSpec } from "../plugins/fixtures/host-idle-shipped-packs";
import { PluginSandbox, sandboxSetSizesForTests, setPluginModuleSandboxUrlForTests } from "../plugins/host";
import { applyPluginCatalog, type PluginView } from "../plugins/plugin";
import { TileHealthMonitor, type TileHealthDeps } from "../plugins/tile-health-monitor";
import { resetVizDriveState } from "../plugins/viz-drive";
import { mockPartial } from "../../test-support/mock-partial";
import { attachPaneSandbox, TileSandboxes } from "./tile-sandboxes";

/**
 * #242 part 2 (follow-up to #233).
 * N3: a pane the mosaic removes unloads its own sandbox at once, through the mosaic's pane-drop hook
 * (main.ts: tileSandboxes.drop), not at the next present's throttled sync. No present runs here.
 * N5: tile-health's per-tile sandbox write counts go when the pane's sandbox goes (drop, restart)
 * and on resetTile; a pane re-added under the same id is counted from scratch.
 * Reverts: N3 the onPaneDrop call in Mosaic.dropPane; N5 the forgetSandboxWrites call in drop().
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BACKROOMS: PluginView = { ...loadShippedPackSpec(REPO, "backrooms"), hash: "h-backrooms", has_frontend: true };
const DRIVEN = "topology";
const IDS = ["plugin:talkers", "plugin:load", "plugin:memory", "plugin:backrooms"] as const;
/** The pane that runs its own sandbox (not the wall's main pane). */
const PANE = IDS[3];

describe("#242 part 2: a removed pane's sandbox goes at once, and its write counts with it", () => {
  const made: PluginSandbox[] = [];
  let opened = 0;
  let packAssetFrame: typeof import("../plugins/pack-asset-frame");
  let host: RenderHost | null = null;

  beforeEach(async () => {
    packAssetFrame = await import("../plugins/pack-asset-frame");
    opened = 0;
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => {
      opened += 1;
      return `${String(opened).padStart(8, "0")}-cccc-4ccc-8ccc-cccccccccccc`;
    });
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
    resetVizDriveState();
  });

  afterEach(() => {
    for (const sb of made.splice(0)) sb.unload();
    host?.dispose();
    host = null;
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
    setPluginModes([]);
    applyPluginCatalog([]);
    resetVizDriveState();
    document.body.classList.remove("mosaic");
    delete document.body.dataset.mosaic;
    delete document.body.dataset.hero;
  });

  function paneTiles(extra: Partial<ConstructorParameters<typeof TileSandboxes<PluginSandbox>>[0]> = {}): TileSandboxes<PluginSandbox> {
    const box = (): PluginSandbox => {
      const sb = new PluginSandbox();
      made.push(sb);
      return sb;
    };
    return new TileSandboxes<PluginSandbox>({
      main: box(),
      create: box,
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: (sb, spec, tileId, config, signal) => attachPaneSandbox(sb, spec, tileId, config, signal, null),
      ...extra,
    });
  }

  /** A four-pane wall whose pane-drop hook is main.ts's: the pane's own sandbox drops. */
  function wall(tiles: TileSandboxes<PluginSandbox>): Mosaic {
    applyPluginCatalog(IDS.map((id) => ({ id: id.slice("plugin:".length), name: id, version: 1, engine: "graph" })));
    setPluginModes(IDS.map((id) => ({ ...topology, id, pluginId: id.slice("plugin:".length), label: id })));
    const wallEl = document.createElement("div");
    Object.defineProperty(wallEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wallEl, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
    host = new RenderHost(wallEl, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel(IDS[0]);
    const mosaic = new Mosaic({
      wall: wallEl, sceneEl, main, host, arcade: {},
      optsFor: () => ({}), onFocus: () => {}, onPromote: () => {}, onLayout: () => {}, onCloseLast: () => {},
      onPaneDrop: (id) => tiles.drop(id),
      sync: () => ({
        theme: themeById("midnight"), filters: {}, anim: { ...DEFAULT_DREAM }, dreaming: false,
        nodeFilter: () => true, lastMsg: null, aliasMap: new Map(),
      }),
    });
    mosaic.setSize("4", IDS[0], "off", { tiles: [...IDS] });
    return mosaic;
  }

  /** Window `message` listeners added since the spy went on and still registered (by identity). */
  function messageListeners(): () => number {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    return () => {
      const events = [
        ...add.mock.calls.map(([type, fn], i) => ({ at: add.mock.invocationCallOrder[i] ?? 0, on: true, type, fn })),
        ...remove.mock.calls.map(([type, fn], i) => ({ at: remove.mock.invocationCallOrder[i] ?? 0, on: false, type, fn })),
      ].sort((a, b) => a.at - b.at);
      const live = new Set<unknown>();
      for (const e of events) {
        if (e.type !== "message") continue;
        if (e.on) live.add(e.fn);
        else live.delete(e.fn);
      }
      return live.size;
    };
  }

  async function bootPane(tiles: TileSandboxes<PluginSandbox>): Promise<void> {
    await tiles.load(PANE, BACKROOMS);
    await vi.waitFor(() => {
      expect(tiles.readyPackFor(PANE), "the pane boots its pack in its own sandbox").toBe(BACKROOMS.id);
    }, { timeout: 3_000 });
  }

  function expectPaneSandboxGone(tiles: TileSandboxes<PluginSandbox>, old: PluginSandbox, base: { live: number; ready: number }, listeners: () => number, when: string): void {
    expect.soft(tiles.has(PANE), `the pane still has its own sandbox ${when}`).toBe(false);
    expect.soft(old.readyPack, `readyPack of the pane's sandbox ${when}`).toBe("");
    expect.soft(sandboxSetSizesForTests(), `live / ready sandboxes ${when}`).toEqual(base);
    expect.soft(document.querySelectorAll("iframe"), `iframes left ${when}`).toHaveLength(0);
    expect.soft(listeners(), `window message listeners added since the boot still registered ${when}`).toBe(0);
  }

  it("(N3) a pane closed on the wall unloads its own sandbox at once, with no present run", async () => {
    const tiles = paneTiles();
    const mosaic = wall(tiles);
    expect(mosaic.tileIds, "the wall's panes").toEqual([...IDS]);
    const base = sandboxSetSizesForTests();
    const listeners = messageListeners();
    await bootPane(tiles);
    const own = tiles.sandboxFor(PANE);
    expect(document.querySelectorAll("iframe"), "the pane's iframe while it runs").toHaveLength(1);
    expect(listeners(), "the pane's sandbox listens for messages").toBeGreaterThan(0);
    mosaic.closeTile(PANE);
    expect(mosaic.tileIds, "panes after the close").not.toContain(PANE);
    expectPaneSandboxGone(tiles, own, base, listeners, "right after the pane closes");
  });

  it("(N3) the wall turned off unloads every pane's own sandbox at once, with no present run", async () => {
    const tiles = paneTiles();
    const mosaic = wall(tiles);
    const base = sandboxSetSizesForTests();
    const listeners = messageListeners();
    await bootPane(tiles);
    const own = tiles.sandboxFor(PANE);
    mosaic.setSize("off", IDS[0], "off");
    expect(mosaic.on, "the wall is off").toBe(false);
    expectPaneSandboxGone(tiles, own, base, listeners, "right after the wall goes off");
  });

  it("(N5) drop, restart and resetTile forget the pane's write counts; a re-added pane counts from scratch", async () => {
    let mon: TileHealthMonitor | null = null;
    const tiles = paneTiles({
      attach: async () => {},
      noteWrite: (id) => mon?.noteSandboxWrite(id),
      forgetSandboxWrites: (id) => mon?.forgetSandboxWrites(id),
    });
    const deps: TileHealthDeps = {
      host: mockPartial<RenderHost>({ software: true }),
      mainScene: mockPartial<NetScene>({}),
      mosaic: mockPartial<NonNullable<TileHealthDeps["mosaic"]>>({ on: true, tileIds: [PANE] }),
      paneEl: () => null,
      sceneFor: () => null,
      packFor: () => BACKROOMS,
      mayBeStatic: () => false,
      awaitingApproval: () => false,
      isVisible: () => true,
      showErrors: () => false,
      tabVisible: () => true,
      onScreen: () => true,
      onHeal: () => {},
      packLive: () => true,
    };
    const health = new TileHealthMonitor(deps);
    mon = health;
    let at = 0;
    /** One tile check (explicit times, 60 s apart): it keeps the write count it saw. */
    const check = (): void => {
      at += 60_000;
      health.runChecks(1, at);
    };
    const writeAndCheck = (): void => {
      health.noteSandboxWrite(PANE);
      check();
      health.noteSandboxWrite(PANE);
    };
    const none = { gen: undefined, lastGen: undefined };

    await tiles.load(PANE, BACKROOMS);
    writeAndCheck();
    expect(health.sandboxWriteCounts(PANE), "counts while the pane's sandbox writes").toEqual({ gen: 2, lastGen: 1 });
    tiles.drop(PANE);
    expect.soft(health.sandboxWriteCounts(PANE), "counts after the pane drops").toEqual(none);

    await tiles.load(PANE, BACKROOMS);
    health.noteSandboxWrite(PANE);
    expect.soft(health.sandboxWriteCounts(PANE), "a re-added pane's first write counts from scratch").toEqual({ gen: 1, lastGen: undefined });
    check();
    health.noteSandboxWrite(PANE);
    check();
    expect.soft(health.sandboxWriteCounts(PANE), "the re-added pane's counts at its next checks").toEqual({ gen: 2, lastGen: 2 });

    await tiles.restart(PANE);
    expect.soft(health.sandboxWriteCounts(PANE), "counts after the pane restarts").toEqual(none);

    writeAndCheck();
    health.resetTile(PANE);
    expect.soft(health.sandboxWriteCounts(PANE), "counts after resetTile").toEqual(none);
    tiles.drop(PANE);
    health.dispose();
  });

  it("wiring: main.ts drops a removed pane's sandbox from the mosaic, and forgets its write counts", () => {
    const main = readFileSync(path.join(REPO, "web/src/app/main.ts"), "utf8");
    const mosaicCfg = main.slice(main.indexOf("mosaic = new Mosaic({"), main.indexOf("pickSuffix:", main.indexOf("mosaic = new Mosaic({")));
    expect(mosaicCfg).toContain("onPaneDrop: (id) => tileSandboxes.drop(id),");
    const sandboxesCfg = main.slice(main.indexOf("const tileSandboxes = new TileSandboxes<PluginSandbox>({"), main.indexOf("function sharedUboPanes("));
    expect(sandboxesCfg).toContain("forgetSandboxWrites: (tileId) => tileHealth?.forgetSandboxWrites(tileId),");
  });
});
