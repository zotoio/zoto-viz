import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import { PluginSandbox, setPluginModuleSandboxUrlForTests, type PluginHostHandlers } from "../plugins/host";
import { attachPluginFrontend, type PluginView } from "../plugins/plugin";
import { packFeedPaneNotice } from "../plugins/plugin-pack-feed";
import { VIZ_UBO, type VizDataFrame, type VizUniformValue } from "../plugins/viz-host";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import { TileSandboxes, type TileSandboxLike, type TileSandboxTarget } from "./tile-sandboxes";

/**
 * #233 (UX Pro): each mosaic tile grows its own colony, at normal speed. Two Ant panes beside a
 * third view (the one main.ts's shared sandbox drives) each boot their own sandbox: 2 iframes,
 * 2 modules, one post per present each, their own pane UBO, and teardown, failure, notice and
 * Retry on one tile leave the other's sandbox and colony unchanged.
 * Revert: ownsSandboxTile returns false (every tile back on the shared sandbox) -> rows red.
 */

const ANT: PluginView = {
  id: "ant-colony",
  name: "Ant Colony",
  version: 1,
  runtime: "typescript",
  hash: "h-ant",
  capabilities: ["viz.read", "viz.write", "config.read"],
};
const TILE_A = "ant-colony";
const TILE_B = "ant-colony!2";
const DRIVEN = "topology";
const N = 30;

function lanFrame(i: number): VizDataFrame {
  const talkers = ["gateway", "lan", "internet", "lan", "lan"].map((role, k) => ({ id: `192.168.1.${10 + k}`, rate: 2 + k, role }));
  return {
    t: 1 + i / 6,
    dt: 1 / 6,
    audio: 0.1,
    packets: [{ proto: "tcp", size: 120, field: 0.3 }, { proto: "udp", size: 80, field: 0.7 }],
    rf: [],
    talkers,
    headlines: [],
  };
}

function floatsDiffer(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

let modulesBooted = 0;
let bootChain: Promise<unknown> = Promise.resolve();

/**
 * One evaluation of the Ant frontend module (what one sandbox iframe boots), writing through
 * `write`. Each iframe is its own realm; here the module reads one globalThis.zoto, so boots queue.
 */
function bootAntModule(write: (slot: number, data: number[]) => void): Promise<(f: VizDataFrame) => void> {
  const next = bootChain.then(() => evalAntModule(write));
  bootChain = next.catch(() => {});
  return next;
}

async function evalAntModule(write: (slot: number, data: number[]) => void): Promise<(f: VizDataFrame) => void> {
  vi.resetModules();
  const zoto: VizZoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => ({}),
    writeBuffer: (slot, data) => write(slot, Array.from(data)),
    writeUniform: () => {},
    writeParticles: () => {},
  };
  Object.assign(globalThis, { zoto });
  await import("../../../plugins/src/ant-colony/frontend/index");
  modulesBooted += 1;
  const onFrame = zoto.onFrame;
  expect(onFrame, "ant-colony frontend registers zoto.onFrame").toBeTypeOf("function");
  return (f) => onFrame!(f);
}


/** Stand-in for a tile's sandbox iframe: boots its own Ant module, posts frames to it. */
class AntTileSandbox implements TileSandboxLike {
  handlers: PluginHostHandlers = {};
  readyPack = "";
  tileId = "";
  posts = 0;
  unloads = 0;
  private step: ((f: VizDataFrame) => void) | null = null;

  setActiveTile(tileId: string): void {
    this.tileId = tileId;
  }

  async boot(fail: boolean): Promise<void> {
    if (fail) throw new Error("sandbox module load failed");
    this.step = await bootAntModule((slot, data) => this.handlers.writeBuffer?.(slot, data));
    this.readyPack = ANT.id;
  }

  frame(f: VizDataFrame): void {
    this.posts += 1;
    this.step?.(f);
  }

  unload(): void {
    this.unloads += 1;
    this.step = null;
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

function antTiles(failing: Set<string>) {
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
  });
  return { tiles, panes, notices, main };
}

async function untilReady<S extends TileSandboxLike>(tiles: TileSandboxes<S>, tileId: string): Promise<void> {
  await vi.waitFor(() => {
    expect(tiles.readyPackFor(tileId), `${tileId} boots Ant in a sandbox of its own`).toBe(ANT.id);
  }, { timeout: 10_000 });
}

/** One Ant tile on its own (the single-tile pane), stepped over frames [from, from + n). */
async function soloSlots(from: number, n: number): Promise<Float32Array> {
  const { tiles, panes } = antTiles(new Set());
  tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }]);
  await untilReady(tiles, TILE_A);
  for (let i = from; i < from + n; i++) tiles.frame(lanFrame(i));
  return new Float32Array(panes.get(TILE_A)!.ubo);
}

describe("#233 two Ant tiles get their own sandbox iframes", () => {
  let packAssetFrame: typeof import("../plugins/pack-asset-frame");
  let opened = 0;

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
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
  });

  it("(a) two Ant tiles boot 2 iframes, and N presents post N frames to each tile", async () => {
    const main = new PluginSandbox();
    const tiles = new TileSandboxes<PluginSandbox>({
      main,
      create: () => new PluginSandbox(),
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: async (sb, spec) => { await attachPluginFrontend(sb, spec, {}); },
    });
    // The happy-dom handshake boots one iframe at a time, so B's pane joins once A is up.
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }]);
    await untilReady(tiles, TILE_A);
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }]);
    await untilReady(tiles, TILE_B);
    const a = tiles.sandboxFor(TILE_A);
    const b = tiles.sandboxFor(TILE_B);
    expect(a === b, "the two Ant tiles share one sandbox").toBe(false);
    expect(a === main || b === main, "an Ant pane runs on the shared sandbox").toBe(false);
    expect(document.querySelectorAll("iframe[sandbox]"), "one sandbox iframe per Ant tile").toHaveLength(2);
    expect(a.liveFrame === b.liveFrame, "the two tiles share one iframe").toBe(false);

    const postsA = vi.spyOn(a, "frame");
    const postsB = vi.spyOn(b, "frame");
    const postsMain = vi.spyOn(main, "frame");
    for (let i = 0; i < N; i++) tiles.frame(lanFrame(i));
    expect(postsA, "posts to tile A").toHaveBeenCalledTimes(N);
    expect(postsB, "posts to tile B").toHaveBeenCalledTimes(N);
    expect(postsMain, "pane frames on the shared sandbox").toHaveBeenCalledTimes(0);

    tiles.sync([]);
    expect(document.querySelectorAll("iframe[sandbox]"), "both pane iframes go when the panes do").toHaveLength(0);
    main.unload();
  });
});

describe("#233 each Ant tile grows its own colony", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
  });

  it("(b) tiles A and B grow apart at one step per present, and tearing down A leaves B with 0 floats different", async () => {
    modulesBooted = 0;
    const { tiles, panes } = antTiles(new Set());
    const paneA = panes.get(TILE_A)!;
    const paneB = panes.get(TILE_B)!;
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }]);
    await untilReady(tiles, TILE_A);
    for (let i = 0; i < N; i++) tiles.frame(lanFrame(i));
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }]);
    await untilReady(tiles, TILE_B);
    for (let i = N; i < 2 * N; i++) tiles.frame(lanFrame(i));

    expect(modulesBooted, "one Ant module per tile").toBe(2);
    const b = tiles.sandboxFor(TILE_B);
    expect(tiles.sandboxFor(TILE_A) === b, "A and B share one sandbox").toBe(false);
    expect(tiles.sharedTiles([DRIVEN, TILE_A, TILE_B]), "the shared UBO still reaches the Ant panes").toEqual([DRIVEN]);
    expect(floatsDiffer(paneA.ubo, paneB.ubo), "A (2N frames) and B (N frames) show one colony").toBeGreaterThan(0);
    const dA = floatsDiffer(paneA.ubo, await soloSlots(0, 2 * N));
    const dB = floatsDiffer(paneB.ubo, await soloSlots(N, N));
    expect(dA, `tile A vs one tile stepped ${2 * N} frames: ${dA} floats differ`).toBe(0);
    expect(dB, `tile B vs one tile stepped ${N} frames: ${dB} floats differ`).toBe(0);

    const before = new Float32Array(paneB.ubo);
    const unloadsB = b.unloads;
    tiles.drop(TILE_A);
    expect(tiles.sandboxFor(TILE_B), "B keeps its sandbox when A goes").toBe(b);
    expect(b.unloads - unloadsB, "unloads of B when A is torn down").toBe(0);
    const dDrop = floatsDiffer(paneB.ubo, before);
    expect(dDrop, `B after A's teardown: ${dDrop} floats differ`).toBe(0);
    tiles.frame(lanFrame(2 * N));
    const dNext = floatsDiffer(paneB.ubo, await soloSlots(N, N + 1));
    expect(dNext, `B's next present vs one tile stepped ${N + 1} frames: ${dNext} floats differ`).toBe(0);
  });

  it("(c) a failed boot and a Retry on A leave B's sandbox, colony and notice untouched", async () => {
    const failing = new Set<string>();
    const { tiles, panes, notices } = antTiles(failing);
    const paneA = panes.get(TILE_A)!;
    const paneB = panes.get(TILE_B)!;
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: ANT }, { id: TILE_B, spec: ANT }]);
    await untilReady(tiles, TILE_A);
    await untilReady(tiles, TILE_B);
    for (let i = 0; i < N; i++) tiles.frame(lanFrame(i));
    const b = tiles.sandboxFor(TILE_B);
    const before = new Float32Array(paneB.ubo);
    const noticesBefore = notices.length;

    failing.add(TILE_A); // A's Retry hits a module that won't start
    expect(await tiles.restart(TILE_A), "A retries on its own sandbox").toBe(true);
    expect(tiles.readyPackFor(TILE_A), "A after the failed boot").toBe("");
    expect(packFeedPaneNotice(TILE_A, ANT.name), "A's couldn't-start notice").not.toBeNull();
    const failNotices = notices.slice(noticesBefore);
    expect(failNotices.filter((n) => n.id === TILE_A && n.text).length, "notices painted on A").toBe(1);
    expect(failNotices.filter((n) => n.id === TILE_B).length, "notices painted on B").toBe(0);
    expect(packFeedPaneNotice(TILE_B, ANT.name), "B's notice").toBeNull();
    expect(tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance").toBe(b);
    expect(b.unloads, "unloads of B").toBe(0);
    const dFail = floatsDiffer(paneB.ubo, before);
    expect(dFail, `B after A failed: ${dFail} floats differ`).toBe(0);

    failing.delete(TILE_A); // Retry again: A starts a fresh colony, B carries on
    expect(await tiles.restart(TILE_A), "A retries on its own sandbox").toBe(true);
    await untilReady(tiles, TILE_A);
    expect(notices.slice(noticesBefore).filter((n) => n.id === TILE_A && n.text === null).length, "A's notice cleared").toBe(1);
    expect(tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance after A's Retry").toBe(b);
    expect(floatsDiffer(paneB.ubo, before), "B after A's Retry").toBe(0);
    tiles.frame(lanFrame(N));
    const dA = floatsDiffer(paneA.ubo, await soloSlots(N, 1));
    const dB = floatsDiffer(paneB.ubo, await soloSlots(0, N + 1));
    expect(dA, `A after Retry vs a fresh tile's first frame: ${dA} floats differ`).toBe(0);
    expect(dB, `B vs one tile stepped ${N + 1} frames: ${dB} floats differ`).toBe(0);
    expect(notices.filter((n) => n.id === TILE_B).length, "notices on B in the whole row").toBe(0);
  });
});
