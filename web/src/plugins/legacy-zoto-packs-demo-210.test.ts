/**
 * #210: the six packs that were on `declare const zoto` (ant-colony, aquarium, koi-pond, metro-lines,
 * rocket-car-soccer, voxel-world) now get the host through getVizZoto(), and each draws a non-empty
 * board from the host's own demo data.
 *
 * One row per pack:
 *  - install a VizZoto whose writes go through the host's VizBufferWriter (built from the pack's
 *    plugin.yml `viz` contract, so its buffer caps apply);
 *  - import the pack's real frontend entry and check it called getVizZoto() (spied);
 *  - feed it the frames the host builds for a view with no monitor traffic: buildVizFrameForPlugin
 *    over an empty StateMsg merges the pack's `viz.idle` demo (`fixture: host`) into each frame;
 *    voxel-world (presentTick) also gets a present tick per frame, since it only writes on present;
 *  - read the board back from the writer and count the pack's entities (ants, fish, koi, stations,
 *    cars, village markers). A blank board (nothing written, or no entities) fails the row.
 *
 * The row also shows the board is drawn from the frames the pack receives, not a fixed picture: with
 * Math.random seeded and the same clock, two runs on the host demo frames write the same board, and a
 * run on the same frames carrying a different (non-demo, live-looking) talker and packet slice writes
 * a different one. (An emptied slice is no contrast for every pack: metro-lines, by design, draws its
 * fictional demo network for a demo frame and for an empty one alike.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VizDataFrame, VizPresentTick } from "../../../plugins/sdk/viz-contract";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import { SLOT_ANTS } from "../../../plugins/src/ant-colony/frontend/colony";
import { AQU_SLOT } from "../../../plugins/src/aquarium/frontend/aquarium";
import { KOI_SLOT } from "../../../plugins/src/koi-pond/frontend/koi-pond";
import { METRO_SLOT_STATIONS } from "../../../plugins/src/metro-lines/frontend/metro";
import { RCS_SLOT } from "../../../plugins/src/rocket-car-soccer/frontend/pack";
import { VOX_SLOT } from "../../../plugins/src/voxel-world/frontend/slots";
import type { StateMsg } from "../core/types";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { monoMs } from "../core/viz-time";
import { buildVizFrameForPlugin, parseVizContract, VizBufferWriter, type VizPluginContract } from "./viz-host";

vi.mock("../../../plugins/sdk/viz-zoto", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../plugins/sdk/viz-zoto")>();
  return { ...mod, getVizZoto: vi.fn(mod.getVizZoto) };
});

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FRAMES = 180;

type Board = (snap: (slot: number) => Float32Array) => number;
type PackRow = { id: string; entry: () => Promise<unknown>; board: Board; entities: string };

/** A live-looking slice (ids outside the host demo set) used only for the contrast run. */
const LIVE_TALKERS: VizDataFrame["talkers"] = [
  { id: "192.168.7.10", rate: 260, role: "lan" },
  { id: "192.168.7.11", rate: 140, role: "lan" },
  { id: "192.168.7.1", rate: 90, role: "gateway" },
];
const LIVE_PACKETS: VizDataFrame["packets"] = [
  { proto: "udp", size: 900, field: 0.7 },
  { proto: "tcp", size: 300, field: 0.2 },
];

const nonZero = (a: Float32Array) => a.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);

const ROWS: PackRow[] = [
  {
    id: "ant-colony",
    entry: () => import("../../../plugins/src/ant-colony/frontend/index"),
    board: (snap) => nonZero(snap(SLOT_ANTS)),
    entities: "ant slot floats",
  },
  {
    id: "aquarium",
    entry: () => import("../../../plugins/src/aquarium/frontend/index"),
    board: (snap) => snap(0)[AQU_SLOT.fishCount]!,
    entities: "fish",
  },
  {
    id: "koi-pond",
    entry: () => import("../../../plugins/src/koi-pond/frontend/index"),
    board: (snap) => snap(0)[KOI_SLOT.koiCount]!,
    entities: "koi",
  },
  {
    id: "metro-lines",
    entry: () => import("../../../plugins/src/metro-lines/frontend/index"),
    board: (snap) => nonZero(snap(METRO_SLOT_STATIONS)),
    entities: "station slot floats",
  },
  {
    id: "rocket-car-soccer",
    entry: () => import("../../../plugins/src/rocket-car-soccer/frontend/index"),
    board: (snap) => snap(0)[RCS_SLOT.carCount]!,
    entities: "cars",
  },
  {
    id: "voxel-world",
    entry: () => import("../../../plugins/src/voxel-world/frontend/index"),
    board: (snap) => nonZero(snap(1)),
    entities: "village marker floats",
  },
];

function packContract(id: string): VizPluginContract {
  const doc = yaml.parse(readFileSync(path.join(REPO, "plugins/src", id, "plugin.yml"), "utf8"));
  const contract = parseVizContract(doc.viz);
  if (!contract) throw new Error(`${id}: plugin.yml has no parseable viz contract`);
  return contract;
}

function emptyState(ts: number): StateMsg {
  return {
    type: "state",
    ts,
    iface: "",
    interfaces: [],
    network: "",
    local_ip: "",
    gateway: "",
    uptime: 0,
    stats: { pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0 },
    devices: [],
    flows: [],
  };
}

/** Load the pack entry against a host writer, drive FRAMES frames, return the board count. */
async function drivePack(row: PackRow, contract: VizPluginContract, live: boolean) {
  vi.resetModules();
  let seed = 0x2100;
  const rng = vi.spyOn(Math, "random").mockImplementation(() => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  });
  const sdk = await import("../../../plugins/sdk/viz-zoto");
  const spy = vi.mocked(sdk.getVizZoto);
  spy.mockClear();
  const writer = new VizBufferWriter(contract);
  const zoto: VizZoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    onPresent: null,
    getConfig: () => ({}),
    writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
    writeUniform: (name, value) => { writer.writeUniform(name, value); },
    writeParticles: () => {},
  };
  Object.assign(globalThis, { zoto });
  await row.entry();
  const hostCalls = spy.mock.calls.length;
  const onFrame = zoto.onFrame;
  if (typeof onFrame !== "function") throw new Error(`${row.id} frontend did not register onFrame`);
  let clock = 1000;
  setVizClockInjector(() => clock);
  let prev = monoMs(0);
  let last: VizDataFrame | null = null;
  for (let i = 0; i < FRAMES; i++) {
    clock += 16;
    const frame = buildVizFrameForPlugin(emptyState(10 + i / 60), prev, 0.12, contract.idle, contract.contract);
    prev = monoMs(clock);
    const fed: VizDataFrame = live
      ? { ...frame, packets: LIVE_PACKETS, rf: [], talkers: LIVE_TALKERS, links: [], headlines: [], demo: false, demoSlices: undefined }
      : frame;
    last = fed;
    onFrame(fed);
    const tick: VizPresentTick = { frameMs: 16, tileId: row.id, pluginClock: i / 60 };
    zoto.onPresent?.(tick);
  }
  rng.mockRestore();
  const slots = Array.from({ length: contract.maxBuffers }, (_, s) => Array.from(writer.snapshot(s)));
  return { hostCalls, board: row.board((s) => writer.snapshot(s)), slots, last };
}

describe("#210 legacy zoto packs: getVizZoto() and a non-empty board from host demo data", () => {
  afterEach(() => {
    resetVizClockInjectors();
    Reflect.deleteProperty(globalThis, "zoto");
  });

  for (const row of ROWS) {
    it(`${row.id}: gets the host through getVizZoto() and draws ${row.entities} from the host demo frames`, async () => {
      const contract = packContract(row.id);
      expect(contract.idle, `${row.id} plugin.yml viz.idle is the host demo fixture`).toEqual({ fixture: "host" });

      const demo = await drivePack(row, contract, false);
      expect(demo.hostCalls, `${row.id} called getVizZoto() when its entry loaded`).toBeGreaterThan(0);
      expect(demo.last?.demo, "the host merged its demo slices into the frame").toBe(true);
      expect(demo.last?.talkers.length, "the host demo frame carries talkers").toBeGreaterThan(0);
      expect(demo.board, `${row.id} board from host demo data (${row.entities})`).toBeGreaterThan(0);

      const again = await drivePack(row, contract, false);
      expect(again.slots, `${row.id} writes the same board on a second seeded demo run`).toEqual(demo.slots);
      const live = await drivePack(row, contract, true);
      expect(live.slots, `${row.id} board depends on the frame data it received`).not.toEqual(demo.slots);
    });
  }
});
