import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { setPackAssetTokenForTests } from "../core/http";
import { PluginSandbox, setPluginModuleSandboxUrlForTests, type PluginHostHandlers } from "../plugins/host";
import { attachPluginFrontend, type PluginView } from "../plugins/plugin";
import { packFeedPaneNotice } from "../plugins/plugin-pack-feed";
import { VIZ_UBO, type VizDataFrame, type VizUniformValue } from "../plugins/viz-host";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import { paneSandboxGaps, TileSandboxes, type TileSandboxLike, type TileSandboxTarget } from "./tile-sandboxes";
import { resetViewStatesForTests, setViewStateTileResolver } from "./view-state";

/**
 * #233 (UX Pro, ZotoBoss): a mosaic pane runs its pack in a sandbox of its own, with no "Preview
 * only" label, only when the pack needs none of the wires pane sandboxes lack (live config pushes,
 * presentTick, graph.read); every other pane stays on main.ts's shared sandbox with the label.
 * One answer, ownsSandboxTile, picks both. Own-sandbox panes get 2 iframes / 2 modules, one post
 * per present each and their own pane UBO, and a teardown, failure ("<Pack> couldn't start." with
 * Retry) or Retry on one leaves the other's sandbox, board and notice unchanged.
 * Revert: ownsSandboxTile returns false (every pane back on the shared sandbox) -> rows red.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** A PluginView from the pack's own plugin.yml: the capabilities and viz contract it declares. */
function manifestSpec(packId: string): PluginView {
  const doc = parse(readFileSync(path.resolve(here, `../../../plugins/src/${packId}/plugin.yml`), "utf8"));
  return {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    runtime: doc.frontend ? "typescript" : "yaml",
    hash: `h-${packId}`,
    capabilities: doc.capabilities ?? [],
    viz: doc.viz,
  };
}

/** Ant declares config.read (its frontend handles zoto.onConfig): it needs live config pushes. */
const ANT = manifestSpec("ant-colony");
/** Backrooms: viz.read / viz.write only, no presentTick: a pane can run it itself. */
const BACKROOMS = manifestSpec("backrooms");
/** Voxel World: config.read and viz.presentTick. */
const VOXEL = manifestSpec("voxel-world");
/** Pulse TS: graph.read. */
const PULSE = manifestSpec("pulse-ts");
/**
 * Fixture: Ant's own frontend module under a manifest without config.read, i.e. a pane-eligible
 * stateful pack, so the colony rows can count floats. (Real Ant waits on per-tile config pushes.)
 */
const COLONY: PluginView = { ...ANT, id: "colony-fixture", name: "Colony Fixture", capabilities: ["viz.read", "viz.write"] };
const TILE_A = "colony-fixture";
const TILE_B = "colony-fixture!2";
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
    this.readyPack = COLONY.id;
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

async function untilReady<S extends TileSandboxLike>(tiles: TileSandboxes<S>, tileId: string, packId = COLONY.id): Promise<void> {
  await vi.waitFor(() => {
    expect(tiles.readyPackFor(tileId), `${tileId} boots its pack in a sandbox of its own`).toBe(packId);
  }, { timeout: 10_000 });
}

/** One colony tile on its own (the single-tile pane), stepped over frames [from, from + n). */
async function soloSlots(from: number, n: number): Promise<Float32Array> {
  const { tiles, panes } = antTiles(new Set());
  tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: COLONY }]);
  await untilReady(tiles, TILE_A);
  for (let i = from; i < from + n; i++) tiles.frame(lanFrame(i));
  return new Float32Array(panes.get(TILE_A)!.ubo);
}

describe("#233 which panes own a sandbox", () => {
  it("(gate) a pane owns a sandbox, and drops Preview only, only for a pack needing no config push, presentTick or graph.read", () => {
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
      [ANT, ["config-push"]],
      [VOXEL, ["config-push", "present-tick"]],
      [PULSE, ["graph-read"]],
    ];
    for (const [spec, gaps] of cases) {
      expect(paneSandboxGaps(spec), `${spec.id}: wires a pane sandbox lacks`).toEqual(gaps);
      const owns = tiles.owns(spec.id, spec);
      expect(owns, `${spec.id}: own sandbox`).toBe(gaps.length === 0);
      expect(tiles.previewOnly(spec.id, spec), `${spec.id}: Preview only label`).toBe(!owns);
    }
    expect(tiles.owns(DRIVEN, BACKROOMS), "the tile the shared sandbox drives").toBe(false);
    tiles.sync(cases.map(([spec]) => ({ id: spec.id, spec })));
    expect(tiles.tiles(), "panes that booted their own sandbox").toEqual([BACKROOMS.id]);
    expect(tiles.sharedTiles(cases.map(([spec]) => spec.id)), "panes left on the shared sandbox (and its UBO)")
      .toEqual([ANT.id, VOXEL.id, PULSE.id]);
    tiles.sync([]);
  });
});

describe("#233 two Backrooms panes get their own sandbox iframes", () => {
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

  it("(a) two Backrooms panes boot 2 iframes, and N presents post N frames to each pane", async () => {
    const box = (): PluginSandbox => {
      const sb = new PluginSandbox();
      made.push(sb);
      return sb;
    };
    const main = box();
    const tiles = new TileSandboxes<PluginSandbox>({
      main,
      create: box,
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: async (sb, spec) => { await attachPluginFrontend(sb, spec, {}); },
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
    for (let i = 0; i < N; i++) tiles.frame(lanFrame(i));
    expect(postsA, "posts to pane A").toHaveBeenCalledTimes(N);
    expect(postsB, "posts to pane B").toHaveBeenCalledTimes(N);
    expect(postsMain, "pane frames on the shared sandbox").toHaveBeenCalledTimes(0);

    tiles.sync([]);
    expect(document.querySelectorAll("iframe[sandbox]"), "both pane iframes go when the panes do").toHaveLength(0);
  });
});

describe("#233 each own-sandbox pane grows its own colony", () => {
  const paneEls = new Map<string, HTMLElement>();

  beforeEach(() => {
    for (const id of [TILE_A, TILE_B]) {
      const el = document.createElement("div");
      el.className = "mosaic-pane";
      document.body.appendChild(el);
      paneEls.set(id, el);
    }
    setViewStateTileResolver((id) => paneEls.get(id) ?? null);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
    setViewStateTileResolver(null);
    resetViewStatesForTests();
    for (const el of paneEls.values()) el.remove();
    paneEls.clear();
  });

  it("(b) panes A and B grow apart at one step per present, and tearing down A leaves B with 0 floats different", async () => {
    modulesBooted = 0;
    const { tiles, panes } = antTiles(new Set());
    const paneA = panes.get(TILE_A)!;
    const paneB = panes.get(TILE_B)!;
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: COLONY }]);
    await untilReady(tiles, TILE_A);
    for (let i = 0; i < N; i++) tiles.frame(lanFrame(i));
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: COLONY }, { id: TILE_B, spec: COLONY }]);
    await untilReady(tiles, TILE_B);
    for (let i = N; i < 2 * N; i++) tiles.frame(lanFrame(i));

    expect(modulesBooted, "one colony module per pane").toBe(2);
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
    tiles.frame(lanFrame(2 * N));
    const dNext = floatsDiffer(paneB.ubo, await soloSlots(N, N + 1));
    expect(dNext, `B's next present vs one tile stepped ${N + 1} frames: ${dNext} floats differ`).toBe(0);
  });

  it("(c) a failing own-sandbox pane shows \"<Pack> couldn't start.\" with Retry on itself only, keeps its own sandbox and leaves B's board unchanged", async () => {
    const failing = new Set<string>();
    const { tiles, panes, notices, main } = antTiles(failing);
    const paneA = panes.get(TILE_A)!;
    const paneB = panes.get(TILE_B)!;
    tiles.sync([{ id: DRIVEN, spec: null }, { id: TILE_A, spec: COLONY }, { id: TILE_B, spec: COLONY }]);
    await untilReady(tiles, TILE_A);
    await untilReady(tiles, TILE_B);
    for (let i = 0; i < N; i++) tiles.frame(lanFrame(i));
    const b = tiles.sandboxFor(TILE_B);
    const before = new Float32Array(paneB.ubo);

    failing.add(TILE_A); // A's restart hits a module that won't start
    expect(await tiles.restart(TILE_A), "A restarts on its own sandbox").toBe(true);
    expect(tiles.readyPackFor(TILE_A), "A after the failed boot").toBe("");
    const noticeA = paneEls.get(TILE_A)!.querySelector(".mosaic-pane-notice-text");
    const retryA = paneEls.get(TILE_A)!.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");
    // The solo copy (view-state couldntStartText, load-failed) and its Retry button.
    expect(noticeA?.textContent, "A's notice").toBe(`${COLONY.name} couldn't start.`);
    expect(retryA?.textContent, "A's notice button").toBe("Retry");
    expect(paneEls.get(TILE_B)!.querySelector(".mosaic-pane-notice"), "a notice on B").toBeNull();
    expect(notices.filter((n) => n.id === TILE_B).length, "pack-feed notices on B").toBe(0);
    expect(packFeedPaneNotice(TILE_B, COLONY.name), "B's pack-feed notice").toBeNull();
    // No silent fallback: A keeps its own (failed) sandbox, so no label and no shared UBO on it.
    expect(tiles.has(TILE_A), "A still owns its sandbox after the failure").toBe(true);
    expect(tiles.sandboxFor(TILE_A) === main, "A fell back to the shared sandbox").toBe(false);
    expect(tiles.previewOnly(TILE_A, COLONY), "A shows Preview only").toBe(false);
    expect(tiles.sharedTiles([DRIVEN, TILE_A, TILE_B]), "panes the shared UBO reaches").toEqual([DRIVEN]);
    expect(tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance").toBe(b);
    expect(b.unloads, "unloads of B").toBe(0);
    const dFail = floatsDiffer(paneB.ubo, before);
    expect(dFail, `B after A failed: ${dFail} floats differ`).toBe(0);

    failing.delete(TILE_A); // the notice's own Retry: A starts a fresh colony, B carries on
    retryA!.click();
    await untilReady(tiles, TILE_A);
    expect(paneEls.get(TILE_A)!.querySelector(".mosaic-pane-notice-text"), "A's notice after Retry").toBeNull();
    expect(tiles.sandboxFor(TILE_B), "B keeps the same sandbox instance after A's Retry").toBe(b);
    expect(floatsDiffer(paneB.ubo, before), "B after A's Retry").toBe(0);
    tiles.frame(lanFrame(N));
    const dA = floatsDiffer(paneA.ubo, await soloSlots(N, 1));
    const dB = floatsDiffer(paneB.ubo, await soloSlots(0, N + 1));
    expect(dA, `A after Retry vs a fresh tile's first frame: ${dA} floats differ`).toBe(0);
    expect(dB, `B vs one tile stepped ${N + 1} frames: ${dB} floats differ`).toBe(0);
    expect(notices.filter((n) => n.id === TILE_B).length, "pack-feed notices on B in the whole row").toBe(0);
  });
});
