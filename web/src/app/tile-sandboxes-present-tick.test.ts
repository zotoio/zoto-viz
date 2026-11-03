import { describe, expect, it, vi } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "../plugins/plugin";
import { paneSandboxGaps, sharedSandboxTile, TileSandboxes, type TileSandboxLike } from "./tile-sandboxes";

/**
 * #235 (presentTick half): no mosaic pane sits on "Preview only". A viz.presentTick pack
 * (voxel-world, fluid-dyn, host-mesh-demo, rocket-car-soccer) gets a pane sandbox of its own and one
 * present tick per display frame with that pane's clock and aspect; and a pane is never treated as
 * "driven" by the shared sandbox unless the global view is that pane (the blank HN Rain pane).
 */

const PRESENT_PACKS = ["voxel-world", "fluid-dyn", "host-mesh-demo", "rocket-car-soccer"].map((id) =>
  mockPartial<PluginView>({
    id,
    name: id,
    hash: `h-${id}`,
    has_frontend: true,
    capabilities: ["viz.read", "viz.write"],
    viz: mockPartial<NonNullable<PluginView["viz"]>>({ contract: 3, presentTick: true }),
  }));
const HN_RAIN = mockPartial<PluginView>({
  id: "hn-rain",
  name: "HN Rain",
  hash: "h-hn",
  has_frontend: true,
  capabilities: ["viz.read", "viz.write"],
  viz: mockPartial<NonNullable<PluginView["viz"]>>({ contract: 2 }),
});

type Tick = [number, string, number | undefined, number | undefined];

function stub(ticks: Tick[]): TileSandboxLike & { readyPack: string } {
  const sb = mockPartial<TileSandboxLike & { readyPack: string }>({
    readyPack: "",
    setActiveTile: vi.fn(),
    frame: vi.fn(),
    unload: vi.fn(),
    deliverPresentTick: (f: number, t: string, c?: number, a?: number) => { ticks.push([f, t, c, a]); },
  });
  return sb;
}

function host(drivenTile = "main") {
  const ticks = new Map<string, Tick[]>();
  let last: Tick[] = [];
  const tiles = new TileSandboxes<TileSandboxLike & { readyPack: string }>({
    main: stub([]),
    create: () => { last = []; return stub(last); },
    drivenTile: () => drivenTile,
    target: () => null,
    mayLoad: () => true,
    attach: async (sb, spec, tileId) => { sb.readyPack = spec.id; ticks.set(tileId, last); },
  });
  return { tiles, ticks };
}

describe("#235: no pane waits on Preview only", () => {
  it("presentTick is no longer a pane sandbox gap; every pack's pane owns its sandbox", () => {
    const { tiles } = host();
    for (const spec of [...PRESENT_PACKS, HN_RAIN]) {
      expect(paneSandboxGaps(spec), spec.id).toEqual([]);
      expect(tiles.owns(`plugin:${spec.id}`, spec), spec.id).toBe(true);
      expect(tiles.previewOnly(`plugin:${spec.id}`, spec), `${spec.id} Preview only`).toBe(false);
    }
  });

  it("each presentTick pane sandbox gets one tick per frame with its own clock and aspect", async () => {
    const { tiles, ticks } = host();
    const panes = [...PRESENT_PACKS, HN_RAIN].map((spec) => ({ id: `plugin:${spec.id}`, spec }));
    tiles.sync(panes);
    await new Promise((r) => setTimeout(r, 0));
    expect(tiles.tiles()).toEqual(panes.map((p) => p.id));
    const n = tiles.presentTick(16, (id) => id.length, (id) => (id.includes("fluid") ? 2 : 1.5));
    expect(n, "ticks posted: presentTick packs only").toBe(PRESENT_PACKS.length);
    for (const spec of PRESENT_PACKS) {
      const id = `plugin:${spec.id}`;
      expect(ticks.get(id), id).toEqual([[16, spec.id, id.length, spec.id === "fluid-dyn" ? 2 : 1.5]]);
    }
    expect(ticks.get("plugin:hn-rain")).toEqual([]);
    tiles.sync([]);
  });

  it("the shared sandbox drives a pane only when the global view is that pane", () => {
    const panes = ["plugin:hn-rain", "plugin:voxel-world"];
    expect(sharedSandboxTile(false, panes, "plugin:hn-rain")).toBe("main");
    expect(sharedSandboxTile(true, panes, "plugin:voxel-world")).toBe("plugin:voxel-world");
    // Global NET Tetris is not a pane: the focus pane (HN Rain) is not "driven", so it owns a sandbox.
    expect(sharedSandboxTile(true, panes, "tetris")).toBe("main");
    const { tiles } = host(sharedSandboxTile(true, panes, "tetris"));
    expect(tiles.previewOnly("plugin:hn-rain", HN_RAIN)).toBe(false);
  });
});
