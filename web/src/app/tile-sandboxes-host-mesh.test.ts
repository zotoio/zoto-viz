import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "../plugins/plugin";
import type { PluginHostHandlers } from "../plugins/host";
import { applyPaneHostMeshSlot } from "./host-mesh-bridge";
import { TileSandboxes, type TileSandboxLike } from "./tile-sandboxes";

/**
 * Koi in a mosaic pane sat still: a pane sandbox's writes reached the pane's UBO but never its host
 * mesh lane, so the koi kept their pinned poses. Pane host-mesh slots now go to that pane's lane.
 */

type Sb = TileSandboxLike & { readyPack: string; handlers?: PluginHostHandlers };

function koiSpec(): PluginView {
  return mockPartial<PluginView>({
    id: "koi-pond",
    name: "Koi Pond",
    hash: "h-koi",
    has_frontend: true,
    capabilities: ["viz.read", "viz.write"],
    assets: [{ id: "koi-kohaku", path: "assets/koi.glb" }] as unknown as PluginView["assets"],
    viz: mockPartial<NonNullable<PluginView["viz"]>>({ contract: 2, maxBuffers: 8, maxBufferFloats: 64, hostMeshSlot: 3, hostMeshSlotCount: 2 }),
  });
}

describe("pane sandboxes drive their pane's host mesh lane", () => {
  it("writeBuffer and writeBatch on a host-mesh slot reach hostMeshWrite with the pane and spec", async () => {
    const sbs: Sb[] = [];
    const writes: [string, string, number][] = [];
    const tiles = new TileSandboxes<Sb>({
      main: mockPartial<Sb>({ readyPack: "", setActiveTile: vi.fn(), frame: vi.fn(), unload: vi.fn() }),
      create: () => { const sb = mockPartial<Sb>({ readyPack: "", setActiveTile: vi.fn(), frame: vi.fn(), unload: vi.fn() }); sbs.push(sb); return sb; },
      drivenTile: () => "main",
      target: () => null,
      mayLoad: () => true,
      attach: async (sb, spec) => { sb.readyPack = spec.id; },
      hostMeshWrite: (tileId, spec, slot) => { writes.push([tileId, spec.id, slot]); },
    });
    tiles.sync([{ id: "plugin:koi-pond", spec: koiSpec() }]);
    await new Promise((r) => setTimeout(r, 0));
    const h = sbs[0]!.handlers!;
    h.writeBuffer!(3, new Array(64).fill(0.5));
    h.writeBatch?.({ buffers: [{ slot: 4, data: new Array(64).fill(0.25) }], uniforms: [] } as never);
    expect(writes).toEqual([["plugin:koi-pond", "koi-pond", 3], ["plugin:koi-pond", "koi-pond", 4]]);
  });

  it("applyPaneHostMeshSlot applies only the pack's host-mesh slot window", () => {
    const lane = { applySlotBuffer: vi.fn() };
    const spec = koiSpec();
    const c = spec.viz as never;
    expect(applyPaneHostMeshSlot(lane, spec, c, 2, [1])).toBe(false);
    expect(applyPaneHostMeshSlot(lane, spec, c, 3, [1])).toBe(true);
    expect(applyPaneHostMeshSlot(lane, spec, c, 4, [1])).toBe(true);
    expect(applyPaneHostMeshSlot(lane, spec, c, 5, [1])).toBe(false);
    expect(applyPaneHostMeshSlot(null, spec, c, 3, [1])).toBe(false);
    expect(lane.applySlotBuffer).toHaveBeenCalledTimes(2);
  });

  it("every shipped host-mesh pack's pane lane advances over N ticks of changing packets", () => {
    const root = resolve(__dirname, "../../../plugins/src");
    const packs = readdirSync(root).filter((id) => {
      const y = resolve(root, id, "plugin.yml");
      return existsSync(y) && /\nassets:/.test(readFileSync(y, "utf8")) && /hostMeshSlot:\s*\d+/.test(readFileSync(y, "utf8"));
    });
    expect(packs.length).toBeGreaterThanOrEqual(4);
    for (const id of packs) {
      const y = readFileSync(resolve(root, id, "plugin.yml"), "utf8");
      const slot = Number(/hostMeshSlot:\s*(\d+)/.exec(y)![1]);
      const spec = mockPartial<PluginView>({ id, assets: [{ id: "a" }] as unknown as PluginView["assets"] });
      const contract = { hostMeshSlot: slot, hostMeshSlotCount: 1 } as never;
      const seen: number[] = [];
      const lane = { applySlotBuffer: (d: ArrayLike<number>) => { seen.push(d[0]!); } };
      for (let t = 0; t < 30; t++) applyPaneHostMeshSlot(lane, spec, contract, slot, [t * 0.1]);
      expect(seen.length, id).toBe(30);
      expect(new Set(seen).size, `${id} lane saw changing packets`).toBe(30);
    }
  });
});
