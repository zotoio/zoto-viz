import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { loadShippedPackSpec } from "../plugins/fixtures/host-idle-shipped-packs";
import { pluginIdleOf } from "../plugins/fixtures/golden-state";
import { PluginSandbox, setPluginModuleSandboxUrlForTests, type PluginHostHandlers } from "../plugins/host";
import { attachPluginFrontend, configStoreId, type PluginView } from "../plugins/plugin";
import { packFeedPaneNotice } from "../plugins/plugin-pack-feed";
import { tileCantDraw, TILE_HEALTH_PATCHES, TILE_PATCH, type TilePatchBytes } from "../plugins/tile-health";
import { TileHealthMonitor, type TileHealthDeps } from "../plugins/tile-health-monitor";
import { mergeVizIdleFrame, VIZ_UBO, type VizDataFrame, type VizUniformValue } from "../plugins/viz-host";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import { SLOT_ANTS, SLOT_CHAMBERS } from "../../../plugins/src/ant-colony/frontend/colony";
import { mockPartial } from "../../test-support/mock-partial";
import { bindCantDrawSurface } from "./cant-draw-surface";
import { SandboxConfigBatcher } from "./sandbox-config-batcher";
import {
  paneSandboxGaps,
  postBatchedConfig,
  TileSandboxes,
  type TileSandboxLike,
  type TileSandboxTarget,
} from "./tile-sandboxes";
import {
  enterCantDrawShader,
  onViewStateChange,
  resetViewStatesForTests,
  setViewStateTileResolver,
  viewStateOf,
} from "./view-state";

/**
 * #233 (UX Pro, ZotoBoss): a mosaic pane runs its pack in a sandbox of its own, with no "Preview
 * only" label, only when the pack needs none of the wires pane sandboxes still lack (presentTick,
 * graph.read: #235); every other pane stays on main.ts's shared sandbox with the label. Live config
 * pushes reach pane sandboxes (one batched post per pane), so Ant panes own theirs. One answer,
 * ownsSandboxTile, picks both. Own-sandbox panes get 2 iframes / 2 modules, one post per present
 * each and their own pane UBO, and a teardown, failure ("<Pack> couldn't start." with Retry),
 * Retry, settings change or tile-health verdict on one leaves the other's sandbox, board and notice
 * unchanged. The colony rows run the real Ant pack on the host's built-in demo data (no capture).
 * Revert: ownsSandboxTile returns false (every pane back on the shared sandbox) -> rows red.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The pack's shipped manifest (plugin.yml + visualisation.yml), with what the server adds for an
 * installed pack: its hash, and has_frontend for a pack with a frontend.entry.
 */
function shipped(packId: string): PluginView {
  const spec = loadShippedPackSpec(REPO, packId);
  expect(spec.frontend?.entry, `${packId} ships a frontend`).toBeTruthy();
  return { ...spec, hash: `h-${packId}`, has_frontend: true };
}

/** Ant: viz.read / viz.write / config.read, idle `fixture: host`. */
const ANT = shipped("ant-colony");
/** Backrooms: viz.read / viz.write, no presentTick. */
const BACKROOMS = shipped("backrooms");
/** Voxel World: config.read and viz.presentTick. */
const VOXEL = shipped("voxel-world");
/** Pulse TS: graph.read. */
const PULSE = shipped("pulse-ts");
const TILE_A = "ant-colony";
const TILE_B = "ant-colony!2";
const TILE_C = "ant-colony!3";
const DRIVEN = "topology";
const N = 30;

/** The host's built-in demo frame for Ant (`idle: fixture: host` on an empty capture): no live data. */
function demoFrame(i: number): VizDataFrame {
  const idle = pluginIdleOf(ANT);
  expect(idle, "Ant declares host idle demo data").toBeDefined();
  const quiet: VizDataFrame = { t: 1 + i / 6, dt: 1 / 6, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
  const f = mergeVizIdleFrame(quiet, idle!);
  expect(f.demo, "the frame is demo data").toBe(true);
  return f;
}

function floatsDiffer(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Non-zero floats in the colony's chamber and ant slots: 0 is an empty colony. */
function colonyFloats(ubo: Float32Array): number {
  let n = 0;
  for (const slot of [SLOT_CHAMBERS, SLOT_ANTS]) {
    for (let i = slot * VIZ_UBO.slotFloats; i < (slot + 1) * VIZ_UBO.slotFloats; i++) if (ubo[i] !== 0) n++;
  }
  return n;
}

let modulesBooted = 0;
let bootChain: Promise<unknown> = Promise.resolve();

type AntModule = { step: (f: VizDataFrame) => void; zoto: VizZoto };

/**
 * One evaluation of the real Ant frontend module (what one sandbox iframe boots), writing through
 * `write`. Each iframe is its own realm; here the module reads one globalThis.zoto, so boots queue.
 */
function bootAntModule(write: (slot: number, data: number[]) => void): Promise<AntModule> {
  const next = bootChain.then(() => evalAntModule(write));
  bootChain = next.catch(() => {});
  return next;
}

async function evalAntModule(write: (slot: number, data: number[]) => void): Promise<AntModule> {
  vi.resetModules();
  let config: Record<string, string> = {};
  const zoto: VizZoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => config,
    writeBuffer: (slot, data) => write(slot, Array.from(data)),
    writeUniform: () => {},
    writeParticles: () => {},
  };
  const onConfig = (cfg: Record<string, string>): void => {
    config = cfg;
    zoto.onConfig?.(cfg);
  };
  Object.assign(globalThis, { zoto });
  await import("../../../plugins/src/ant-colony/frontend/index");
  modulesBooted += 1;
  const onFrame = zoto.onFrame;
  expect(onFrame, "ant-colony frontend registers zoto.onFrame").toBeTypeOf("function");
  return { step: (f) => onFrame!(f), zoto: { ...zoto, onConfig } };
}

/** Stand-in for a tile's sandbox iframe: boots its own Ant module, posts frames to it. */
class AntTileSandbox implements TileSandboxLike {
  handlers: PluginHostHandlers = {};
  readyPack = "";
  tileId = "";
  posts = 0;
  unloads = 0;
  private mod: AntModule | null = null;

  setActiveTile(tileId: string): void {
    this.tileId = tileId;
  }

  async boot(fail: boolean): Promise<void> {
    if (fail) throw new Error("sandbox module load failed");
    this.mod = await bootAntModule((slot, data) => this.handlers.writeBuffer?.(slot, data));
    this.readyPack = ANT.id;
  }

  frame(f: VizDataFrame): void {
    this.posts += 1;
    this.mod?.step(f);
  }

  setConfig(config: Record<string, string>): void {
    this.mod?.zoto.onConfig?.(config);
  }

  unload(): void {
    this.unloads += 1;
    this.mod = null;
    this.readyPack = "";
  }
}

/** A pane scene: keeps the UBO its tile's writer hands it. */
class Pane implements TileSandboxTarget {
  ubo = new Float32Array(VIZ_UBO.totalFloats);
  setPluginUboBuffer(buf: Float32Array): void {
    this.ubo = new Float32Array(buf.subarray(0, VIZ_UBO.totalFloats));
  }
  setPluginUniform(_name: string, _value: VizUniformValue): boolean {
    return true;
  }
}

type Notice = { id: string; text: string | null | undefined };

function antTiles(failing: Set<string>, noteWrite?: (tileId: string) => void) {
  const panes = new Map([[TILE_A, new Pane()], [TILE_B, new Pane()]]);
  const notices: Notice[] = [];
  const main = new AntTileSandbox();
  const tiles = new TileSandboxes<AntTileSandbox>({
    main,
    create: () => new AntTileSandbox(),
    drivenTile: () => DRIVEN,
    target: (id) => panes.get(id) ?? null,
    mayLoad: () => true,
    attach: (sb, _spec, tileId) => sb.boot(failing.has(tileId)),
    noticeHost: () => ({ setPaneNotice: (id, text) => { notices.push({ id, text }); } }),
    noteWrite,
  });
  return { tiles, panes, notices, main };
}

async function untilReady<S extends TileSandboxLike>(tiles: TileSandboxes<S>, tileId: string, packId = ANT.id): Promise<void> {
  await vi.waitFor(() => {
    expect(tiles.readyPackFor(tileId), `${tileId} boots its pack in a sandbox of its own`).toBe(packId);
  }, { timeout: 10_000 });
}

/** One Ant tile on its own (the single-tile pane), stepped over demo frames [from, from + n). */
async function soloSlots(from: number, n: number): Promise<Float32Array> {
  const { tiles, panes } = antTiles(new Set());
  tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }]);
  await untilReady(tiles, TILE_A);
  for (let i = from; i < from + n; i++) tiles.frame(demoFrame(i));
  return new Float32Array(panes.get(TILE_A)!.ubo);
}

const paneEls = new Map<string, HTMLElement>();

function mountPanes(ids: readonly string[]): void {
  for (const id of ids) {
    const el = document.createElement("div");
    el.className = "mosaic-pane";
    document.body.appendChild(el);
    paneEls.set(id, el);
  }
  setViewStateTileResolver((id) => paneEls.get(id) ?? null);
}

function unmountPanes(): void {
  setViewStateTileResolver(null);
  resetViewStatesForTests();
  for (const el of paneEls.values()) el.remove();
  paneEls.clear();
}

function noticeText(tileId: string): string | null {
  return paneEls.get(tileId)?.querySelector(".mosaic-pane-notice-text")?.textContent ?? null;
}

describe("#233 which panes own a sandbox", () => {
  it("(gate) a pane owns a sandbox, and drops Preview only, only for a pack needing no presentTick or graph.read", () => {
    const tiles = new TileSandboxes<TileSandboxLike>({
      main: new AntTileSandbox(),
      create: () => new AntTileSandbox(),
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: async () => {},
    });
    const cases: [PluginView, string[]][] = [
      [BACKROOMS, []],
      [ANT, []],
      [VOXEL, ["present-tick"]],
      [PULSE, ["graph-read"]],
    ];
    expect(ANT.capabilities, "Ant reads live config").toContain("config.read");
    for (const [spec, gaps] of cases) {
      expect(paneSandboxGaps(spec), `${spec.id}: wires a pane sandbox lacks`).toEqual(gaps);
      const owns = tiles.owns(spec.id, spec);
      expect(owns, `${spec.id}: own sandbox`).toBe(gaps.length === 0);
      expect(tiles.previewOnly(spec.id, spec), `${spec.id}: Preview only label`).toBe(!owns);
    }
    expect(tiles.owns(DRIVEN, BACKROOMS), "the tile the shared sandbox drives").toBe(false);
    tiles.sync(cases.map(([spec]) => ({ id: spec.id, spec })));
    expect(tiles.tiles(), "panes that booted their own sandbox").toEqual([BACKROOMS.id, ANT.id]);
    expect(tiles.sharedTiles(cases.map(([spec]) => spec.id)), "panes left on the shared sandbox (and its UBO)")
      .toEqual([VOXEL.id, PULSE.id]);
    tiles.sync([]);
  });
});

/** Real PluginSandboxes (happy-dom handshake, a data: module): iframes, ports, ready. */
function realSandboxRows(): {
  made: PluginSandbox[];
  opened: () => number;
} {
  let packAssetFrame: typeof import("../plugins/pack-asset-frame");
  let opened = 0;
  const made: PluginSandbox[] = [];
  beforeEach(async () => {
    packAssetFrame = await import("../plugins/pack-asset-frame");
    opened = 0;
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => {
      opened += 1;
      return `${String(opened).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
    });
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
  });
  afterEach(() => {
    // Unload every sandbox a row made, so the host's live / ready sets never leak into the next row.
    for (const sb of made.splice(0)) sb.unload();
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
  });
  return { made, opened: () => opened };
}

describe("#233 two Backrooms panes get their own sandbox iframes", () => {
  const rows = realSandboxRows();

  it("(a) two Backrooms panes boot 2 iframes, and N presents post N frames to each pane", async () => {
    const box = (): PluginSandbox => {
      const sb = new PluginSandbox();
      rows.made.push(sb);
      return sb;
    };
    const main = box();
    const tiles = new TileSandboxes<PluginSandbox>({
      main,
      create: box,
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: async (sb, spec, _tileId, config) => { await attachPluginFrontend(sb, spec, config); },
    });
    const paneB = `${BACKROOMS.id}!2`;
    // The happy-dom handshake boots one iframe at a time, so B's pane joins once A is up.
    tiles.sync([{ id: DRIVEN, spec: null }, { id: BACKROOMS.id, spec: BACKROOMS }]);
    await untilReady(tiles, BACKROOMS.id, BACKROOMS.id);
    tiles.sync([{ id: DRIVEN, spec: null }, { id: BACKROOMS.id, spec: BACKROOMS }, { id: paneB, spec: BACKROOMS }]);
    await untilReady(tiles, paneB, BACKROOMS.id);
    const a = tiles.sandboxFor(BACKROOMS.id);
    const b = tiles.sandboxFor(paneB);
    expect(a === b, "the two panes share one sandbox").toBe(false);
    expect(a === main || b === main, "a pane runs on the shared sandbox").toBe(false);
    expect(document.querySelectorAll("iframe[sandbox]"), "one sandbox iframe per pane").toHaveLength(2);
    expect(a.liveFrame === b.liveFrame, "the two panes share one iframe").toBe(false);

    const postsA = vi.spyOn(a, "frame");
    const postsB = vi.spyOn(b, "frame");
    const postsMain = vi.spyOn(main, "frame");
    for (let i = 0; i < N; i++) tiles.frame(demoFrame(i));
    expect(postsA, "posts to pane A").toHaveBeenCalledTimes(N);
    expect(postsB, "posts to pane B").toHaveBeenCalledTimes(N);
    expect(postsMain, "pane frames on the shared sandbox").toHaveBeenCalledTimes(0);

    tiles.sync([]);
    expect(document.querySelectorAll("iframe[sandbox]"), "both pane iframes go when the panes do").toHaveLength(0);
  });
});

/** Config messages a sandbox posted on its own port (what its frame receives). */
function portConfigs(sb: PluginSandbox): () => Record<string, string>[] {
  const port: MessagePort | null = Reflect.get(sb, "hostPort");
  expect(port, "the pane's sandbox port").toBeTruthy();
  const spy = vi.spyOn(port!, "postMessage");
  return () => spy.mock.calls.map((c) => c[0]).filter((m) => m?.type === "config").map((m) => m.config);
}

describe("#233 settings reach each Ant pane's own sandbox, once per change, in place", () => {
  const rows = realSandboxRows();
  const ANT_STORE = configStoreId(ANT);
  let store: Record<string, string> = {};
  let frames: (() => void)[] = [];
  const readyCalls: string[] = [];
  const stateChanges: string[] = [];
  let offStates: () => void = () => {};

  beforeEach(() => {
    store = { preset: "formicarium", seed: "4242", antCap: "96" };
    frames = [];
    readyCalls.length = 0;
    stateChanges.length = 0;
    offStates = onViewStateChange((id) => { stateChanges.push(`${id}:${viewStateOf(id)?.kind}`); });
  });
  afterEach(() => offStates());

  function configTiles(gate?: { tileId: string; until: Promise<void> }) {
    const box = (): PluginSandbox => {
      const sb = new PluginSandbox();
      rows.made.push(sb);
      return sb;
    };
    const tiles = new TileSandboxes<PluginSandbox>({
      main: box(),
      create: box,
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      configFor: (spec) => (configStoreId(spec) === ANT_STORE ? { ...store } : {}),
      attach: async (sb, spec, tileId, config) => {
        if (gate?.tileId === tileId) await gate.until; // the late pane is still Starting
        await attachPluginFrontend(sb, spec, config);
      },
      afterReady: (id) => { readyCalls.push(id); },
    });
    const sharedPosts: Record<string, string>[] = [];
    // main.ts's batcher: one onPost per store per frame (shared sandbox not on Ant here).
    const batcher = new SandboxConfigBatcher(
      (storeId, config) => postBatchedConfig(storeId, config, { loaded: false, setConfig: (c) => sharedPosts.push(c) }, tiles),
      (cb) => frames.push(cb),
      () => {},
    );
    return { tiles, batcher, sharedPosts };
  }

  /** One settings change: each field edit schedules the whole store (onPluginChange / onPluginFields). */
  function change(batcher: SandboxConfigBatcher, fields: Record<string, string>): void {
    for (const [k, v] of Object.entries(fields)) {
      store = { ...store, [k]: v };
      batcher.schedule(ANT_STORE, { ...store });
    }
    for (const run of frames.splice(0)) run();
  }

  async function bootSeq(tiles: TileSandboxes<PluginSandbox>, panes: [string, PluginView][]): Promise<void> {
    const on: { id: string; spec: PluginView | null }[] = [{ id: DRIVEN, spec: null }];
    for (const [id, spec] of panes) {
      on.push({ id, spec });
      tiles.sync(on);
      await untilReady(tiles, id, spec.id);
    }
  }

  it("(d) one change to three fields: one batched post per Ant pane (2), none to Backrooms, both update in place", async () => {
    const { tiles, batcher, sharedPosts } = configTiles();
    await bootSeq(tiles, [[TILE_A, ANT], [TILE_B, ANT], [BACKROOMS.id, BACKROOMS]]);
    const sbs = [TILE_A, TILE_B, BACKROOMS.id].map((id) => tiles.sandboxFor(id));
    const [a, b, back] = sbs;
    const iframes = sbs.map((sb) => sb.liveFrame);
    const loads = sbs.map((sb) => Reflect.get(sb, "iframeLoadCount"));
    const openedBefore = rows.opened();
    const posts = sbs.map((sb) => vi.spyOn(sb, "setConfig"));
    const onPort = [a, b].map((sb) => portConfigs(sb));
    stateChanges.length = 0;

    change(batcher, { preset: "night-glow", seed: "7", antCap: "48" });

    const final = { preset: "night-glow", seed: "7", antCap: "48" };
    expect(posts[0]!.mock.calls.length + posts[1]!.mock.calls.length, "batched posts across the two Ant panes").toBe(2);
    expect(posts[0], "posts to Ant pane A").toHaveBeenCalledTimes(1);
    expect(posts[1], "posts to Ant pane B").toHaveBeenCalledTimes(1);
    expect(posts[2], "posts to the Backrooms pane").toHaveBeenCalledTimes(0);
    expect(sharedPosts, "posts to the shared sandbox (not on Ant)").toHaveLength(0);
    expect(onPort[0]!(), "config A's frame received").toEqual([final]);
    expect(onPort[1]!(), "config B's frame received").toEqual([final]);
    // In place: same iframe, same load count, no new pack-asset frame, still ready, no new state.
    sbs.forEach((sb, i) => {
      expect(sb.liveFrame === iframes[i] && !!sb.liveFrame?.isConnected, `pane ${i} keeps its iframe`).toBe(true);
      expect(Reflect.get(sb, "iframeLoadCount"), `pane ${i} iframe loads`).toBe(loads[i]);
    });
    expect(rows.opened() - openedBefore, "pack-asset frames opened by the change").toBe(0);
    expect([a, b, back].map((sb) => sb.readyPack), "packs ready after the change").toEqual([ANT.id, ANT.id, BACKROOMS.id]);
    expect(readyCalls, "ready (and the Starting card's sky start) per pane").toEqual([TILE_A, TILE_B, BACKROOMS.id]);
    expect(stateChanges, "view-state changes from the settings change").toEqual([]);
  });

  it("(e) a pane still Starting gets no posts, then one apply of the merged config on ready", async () => {
    let release: () => void = () => {};
    const until = new Promise<void>((r) => { release = r; });
    const { tiles, batcher } = configTiles({ tileId: TILE_C, until });
    await bootSeq(tiles, [[TILE_A, ANT], [TILE_B, ANT]]);
    const [a, b] = [TILE_A, TILE_B].map((id) => tiles.sandboxFor(id));
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }, { id: TILE_C, spec: ANT }]);
    const c = tiles.sandboxFor(TILE_C);
    expect(c === a || c === b, "the late pane has a sandbox of its own").toBe(false);
    expect(tiles.awaitingReady(TILE_C), "the late pane is Starting").toBe(true);
    expect(c.readyPack, "the late pane's sandbox before ready").toBe("");
    const posts = [a, b, c].map((sb) => vi.spyOn(sb, "setConfig"));

    change(batcher, { preset: "night-glow" });
    change(batcher, { seed: "7", antCap: "48" });
    const final = { preset: "night-glow", seed: "7", antCap: "48" };
    expect(posts[0], "posts to A, one per change").toHaveBeenCalledTimes(2);
    expect(posts[1], "posts to B, one per change").toHaveBeenCalledTimes(2);
    expect(posts[2], "posts to the late pane before it was ready").toHaveBeenCalledTimes(0);

    release();
    await untilReady(tiles, TILE_C);
    expect(posts[2], "applies to the late pane on ready").toHaveBeenCalledTimes(1);
    expect(posts[2]!.mock.calls[0]![0], "the late pane's one apply").toEqual(final);
    const frameC = c.liveFrame;
    expect(document.querySelectorAll("iframe[sandbox]"), "one iframe per pane").toHaveLength(3);
    expect(rows.opened(), "pack-asset frames (one per pane, none recreated)").toBe(3);
    expect(readyCalls, "ready (and the Starting card's sky start) per pane").toEqual([TILE_A, TILE_B, TILE_C]);
    expect(stateChanges, "view-state changes while catching up").toEqual([]);
    tiles.frame(demoFrame(0));
    expect(c.liveFrame === frameC && !!frameC?.isConnected, "the late pane keeps its iframe").toBe(true);
    expect([a, b, c].map((sb) => sb.readyPack), "packs ready").toEqual([ANT.id, ANT.id, ANT.id]);
  });
});

describe("#233 each own-sandbox Ant pane grows its own colony on demo data", () => {
  beforeEach(() => mountPanes([TILE_A, TILE_B]));
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
    unmountPanes();
  });

  it("(b) panes A and B grow apart at one step per present, and tearing down A leaves B with 0 floats different", async () => {
    modulesBooted = 0;
    const { tiles, panes } = antTiles(new Set());
    const paneA = panes.get(TILE_A)!;
    const paneB = panes.get(TILE_B)!;
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }]);
    await untilReady(tiles, TILE_A);
    for (let i = 0; i < N; i++) tiles.frame(demoFrame(i));
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }]);
    await untilReady(tiles, TILE_B);
    for (let i = N; i < 2 * N; i++) tiles.frame(demoFrame(i));

    expect(modulesBooted, "one colony module per pane").toBe(2);
    expect(colonyFloats(paneA.ubo), "A's colony (chambers + ants) on demo data").toBeGreaterThan(0);
    expect(colonyFloats(paneB.ubo), "B's colony (chambers + ants) on demo data").toBeGreaterThan(0);
    const b = tiles.sandboxFor(TILE_B);
    expect(tiles.sandboxFor(TILE_A) === b, "A and B share one sandbox").toBe(false);
    expect(tiles.sharedTiles([DRIVEN, TILE_A, TILE_B]), "the shared UBO still reaches the own-sandbox panes").toEqual([DRIVEN]);
    expect(floatsDiffer(paneA.ubo, paneB.ubo), "A (2N frames) and B (N frames) show one colony").toBeGreaterThan(0);
    const dA = floatsDiffer(paneA.ubo, await soloSlots(0, 2 * N));
    const dB = floatsDiffer(paneB.ubo, await soloSlots(N, N));
    expect(dA, `pane A vs one tile stepped ${2 * N} frames: ${dA} floats differ`).toBe(0);
    expect(dB, `pane B vs one tile stepped ${N} frames: ${dB} floats differ`).toBe(0);

    const before = new Float32Array(paneB.ubo);
    const unloadsB = b.unloads;
    tiles.drop(TILE_A);
    expect(tiles.sandboxFor(TILE_B), "B keeps its sandbox when A goes").toBe(b);
    expect(b.unloads - unloadsB, "unloads of B when A is torn down").toBe(0);
    const dDrop = floatsDiffer(paneB.ubo, before);
    expect(dDrop, `B after A's teardown: ${dDrop} floats differ`).toBe(0);
    tiles.frame(demoFrame(2 * N));
    const dNext = floatsDiffer(paneB.ubo, await soloSlots(N, N + 1));
    expect(dNext, `B's next present vs one tile stepped ${N + 1} frames: ${dNext} floats differ`).toBe(0);
  });

  it("(c) a failing own-sandbox pane shows \"Ant Colony couldn't start.\" with Retry on itself only, keeps its own sandbox and leaves B's board unchanged", async () => {
    const failing = new Set<string>();
    const { tiles, panes, notices, main } = antTiles(failing);
    const paneA = panes.get(TILE_A)!;
    const paneB = panes.get(TILE_B)!;
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }]);
    await untilReady(tiles, TILE_A);
    await untilReady(tiles, TILE_B);
    for (let i = 0; i < N; i++) tiles.frame(demoFrame(i));
    const b = tiles.sandboxFor(TILE_B);
    const before = new Float32Array(paneB.ubo);
    expect(colonyFloats(before), "B's colony before A fails").toBeGreaterThan(0);

    failing.add(TILE_A); // A's restart hits a module that won't start
    expect(await tiles.restart(TILE_A), "A restarts on its own sandbox").toBe(true);
    expect(tiles.readyPackFor(TILE_A), "A after the failed boot").toBe("");
    const retryA = paneEls.get(TILE_A)!.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");
    // The solo copy (view-state couldntStartText, load-failed) and its Retry button.
    expect(noticeText(TILE_A), "A's notice").toBe(`${ANT.name} couldn't start.`);
    expect(retryA?.textContent, "A's notice button").toBe("Retry");
    expect(paneEls.get(TILE_B)!.querySelector(".mosaic-pane-notice"), "a notice on B").toBeNull();
    expect(notices.filter((n) => n.id === TILE_B).length, "pack-feed notices on B").toBe(0);
    expect(packFeedPaneNotice(TILE_B, ANT.name), "B's pack-feed notice").toBeNull();
    // No silent fallback: A keeps its own (failed) sandbox, so no label and no shared UBO on it.
    expect(tiles.has(TILE_A), "A still owns its sandbox after the failure").toBe(true);
    expect(tiles.sandboxFor(TILE_A) === main, "A fell back to the shared sandbox").toBe(false);
    expect(tiles.previewOnly(TILE_A, ANT), "A shows Preview only").toBe(false);
    expect(tiles.sharedTiles([DRIVEN, TILE_A, TILE_B]), "panes the shared UBO reaches").toEqual([DRIVEN]);
    expect(tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance").toBe(b);
    expect(b.unloads, "unloads of B").toBe(0);
    const dFail = floatsDiffer(paneB.ubo, before);
    expect(dFail, `B after A failed: ${dFail} floats differ`).toBe(0);

    failing.delete(TILE_A); // the notice's own Retry: A starts a fresh colony, B carries on
    retryA!.click();
    await untilReady(tiles, TILE_A);
    expect(noticeText(TILE_A), "A's notice after Retry").toBeNull();
    expect(tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance after A's Retry").toBe(b);
    expect(floatsDiffer(paneB.ubo, before), "B after A's Retry").toBe(0);
    tiles.frame(demoFrame(N));
    const dA = floatsDiffer(paneA.ubo, await soloSlots(N, 1));
    const dB = floatsDiffer(paneB.ubo, await soloSlots(0, N + 1));
    expect(dA, `A after Retry vs a fresh tile's first frame: ${dA} floats differ`).toBe(0);
    expect(dB, `B vs one tile stepped ${N + 1} frames: ${dB} floats differ`).toBe(0);
    expect(notices.filter((n) => n.id === TILE_B).length, "pack-feed notices on B in the whole row").toBe(0);
  });
});

type PatchKind = "noisy" | "black";

/** A five-patch tile read: "black" is uniform (empty), "noisy" has detail. */
function patch(kind: PatchKind): TilePatchBytes {
  const b = new Uint8Array(TILE_PATCH * TILE_PATCH * 4 * TILE_HEALTH_PATCHES);
  for (let i = 0; i < b.length; i += 4) {
    const v = kind === "black" ? 0 : (i * 37) % 255;
    b[i] = v;
    b[i + 1] = v;
    b[i + 2] = v;
    b[i + 3] = 255;
  }
  return b;
}

/**
 * The production monitor over two own-sandbox Ant panes, wired the way main.ts wires it: the
 * pane's writes note its own tile, packLive / previewOnly / onCantStart come from TileSandboxes,
 * couldntStart / cantDraw from the tile's view state. pictureSerial never advances, so a tile
 * that is not drawing reads "stalled" (noisy) or "uniform" (black).
 */
function paneHealth(kinds: Record<string, PatchKind>) {
  const heals: string[] = [];
  const cantStarts: string[] = [];
  let mon: TileHealthMonitor | null = null;
  const { tiles, panes } = antTiles(new Set(), (id) => mon?.noteSandboxWrite(id));
  const scenes = new Map([TILE_A, TILE_B].map((id) => [id, mockPartial<NetScene>({
    viewEl: paneEls.get(id)!,
    pictureSerial: 1,
    gpuContextLost: false,
    lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
  })]));
  const deps: TileHealthDeps = {
    host: mockPartial<RenderHost>({ software: true, canvas: document.createElement("canvas"), pixelRatio: 1, gl: null }),
    mainScene: scenes.get(TILE_A)!,
    mosaic: mockPartial<NonNullable<TileHealthDeps["mosaic"]>>({ on: true, tileIds: [TILE_A, TILE_B] }),
    paneEl: (id) => paneEls.get(id) ?? null,
    sceneFor: (id) => scenes.get(id) ?? null,
    packFor: () => ANT,
    mayBeStatic: () => false,
    awaitingApproval: () => false,
    isVisible: () => true,
    showErrors: () => false,
    tabVisible: () => true,
    onScreen: () => true,
    onHeal: (id, step) => { heals.push(`${id}:${step}`); },
    packLive: (id, packId) => tiles.readyPackFor(id) === packId,
    previewOnly: (id) => tiles.previewOnly(id, ANT),
    onCantStart: (id) => { cantStarts.push(id); return tiles.showCouldntStart(id); },
    couldntStart: (id) => viewStateOf(id)?.kind === "couldnt-start",
    cantDraw: (id) => tileCantDraw(viewStateOf(id)),
  };
  mon = new TileHealthMonitor(deps);
  const sceneTile = new Map([...scenes].map(([id, sc]) => [sc, id]));
  Reflect.set(mon, "sampleScene", (sc: NetScene) => patch(kinds[sceneTile.get(sc) ?? ""] ?? "black"));
  return { mon, tiles, panes, heals, cantStarts };
}

/** 60 s of checks; before each, the listed panes' own sandboxes get the next demo frame. */
function runHealth(h: ReturnType<typeof paneHealth>, drawing: readonly string[], from = 0): number {
  let i = from;
  for (let t = 0; t < 60_000; t += 700) {
    for (const id of drawing) h.tiles.sandboxFor(id).frame(demoFrame(i));
    i += 1;
    h.mon.tick(t);
  }
  return i;
}

describe("#233 tile-health per own-sandbox pane", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let offSurface: () => void = () => {};
  beforeEach(() => {
    mountPanes([TILE_A, TILE_B]);
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    offSurface();
    offSurface = () => {};
    info.mockRestore();
    Reflect.deleteProperty(globalThis, "zoto");
    unmountPanes();
  });

  async function bootBoth(h: ReturnType<typeof paneHealth>): Promise<void> {
    h.tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }]);
    await untilReady(h.tiles, TILE_A);
    await untilReady(h.tiles, TILE_B);
  }

  it("(f) writes on pane A never make pane B look drawn: B's stall is flagged while A writes", async () => {
    const h = paneHealth({ [TILE_A]: "noisy", [TILE_B]: "noisy" });
    await bootBoth(h);
    runHealth(h, [TILE_A]);
    expect(colonyFloats(h.panes.get(TILE_A)!.ubo), "A's colony is drawing").toBeGreaterThan(0);
    expect(h.heals.filter((x) => x.startsWith(`${TILE_A}:`)), "heals on A, which writes").toEqual([]);
    expect(h.heals.filter((x) => x.startsWith(`${TILE_B}:`)), "B, which never writes, flagged stalled").toContain(`${TILE_B}:resend-frame`);
    expect(h.cantStarts, "tiles handed to couldn't-start").toEqual([TILE_B]);
  });

  it("(g) tile-health's couldn't-start on pane A: A's own notice and Retry, B untouched", async () => {
    const h = paneHealth({ [TILE_A]: "black", [TILE_B]: "noisy" });
    await bootBoth(h);
    const b = h.tiles.sandboxFor(TILE_B);
    const firstA = h.tiles.sandboxFor(TILE_A);
    const end = runHealth(h, [TILE_B]);
    expect(h.cantStarts, "tiles handed to couldn't-start").toEqual([TILE_A]);
    expect(noticeText(TILE_A), "A's notice").toBe(`${ANT.name} couldn't start.`);
    const retryA = paneEls.get(TILE_A)!.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");
    expect(retryA?.textContent, "A's notice button").toBe("Retry");
    expect(h.tiles.previewOnly(TILE_A, ANT), "A shows Preview only").toBe(false);
    expect(paneEls.get(TILE_B)!.querySelector(".mosaic-pane-notice"), "a notice on B").toBeNull();
    expect(h.heals.filter((x) => x.startsWith(`${TILE_B}:`)), "heals on B").toEqual([]);
    expect(h.tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance").toBe(b);
    expect(b.unloads, "unloads of B").toBe(0);
    const dB = floatsDiffer(h.panes.get(TILE_B)!.ubo, await soloSlots(0, end));
    expect(dB, `B vs one tile stepped ${end} frames: ${dB} floats differ`).toBe(0);

    retryA!.click(); // that pane's Retry restarts that pane's sandbox only
    await vi.waitFor(() => { expect(h.tiles.sandboxFor(TILE_A) === firstA, "A on a new sandbox after Retry").toBe(false); });
    await untilReady(h.tiles, TILE_A);
    expect(noticeText(TILE_A), "A's notice after Retry").toBeNull();
    expect(h.tiles.sandboxFor(TILE_B), "B's sandbox after A's Retry").toBe(b);
    expect(b.unloads, "unloads of B after A's Retry").toBe(0);
  });

  it("(h) #227 cantDraw on pane A: no heal loop on A, A keeps its couldn't-draw line, B untouched", async () => {
    offSurface = bindCantDrawSurface(() => ANT.name ?? ANT.id);
    const h = paneHealth({ [TILE_A]: "black", [TILE_B]: "noisy" });
    await bootBoth(h);
    const b = h.tiles.sandboxFor(TILE_B);
    enterCantDrawShader(TILE_A, ANT.id);
    const end = runHealth(h, [TILE_B]);
    expect(h.heals, "heals on either pane").toEqual([]);
    expect(h.cantStarts, "tiles handed to couldn't-start").toEqual([]);
    expect(tileCantDraw(viewStateOf(TILE_A)), "A still cant-draw").toBe(true);
    // UX Pro: never a silent blank. The existing #179 c line (cant-draw-surface) stays on A.
    expect(paneEls.get(TILE_A)!.querySelector(".tile-cant-draw__text")?.textContent, "A's line")
      .toBe(`${ANT.name} couldn't draw. Other tiles aren't affected. Pick another view, or reload to try again.`);
    expect(noticeText(TILE_A), "a couldn't-start notice on A").toBeNull();
    expect(h.tiles.has(TILE_A), "A keeps its own sandbox").toBe(true);
    expect(paneEls.get(TILE_B)!.querySelector(".tile-cant-draw, .mosaic-pane-notice"), "a line or notice on B").toBeNull();
    expect(h.tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance").toBe(b);
    const dB = floatsDiffer(h.panes.get(TILE_B)!.ubo, await soloSlots(0, end));
    expect(dB, `B vs one tile stepped ${end} frames: ${dB} floats differ`).toBe(0);
  });
});
