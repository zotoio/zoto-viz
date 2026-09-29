import { describe, expect, it, vi } from "vitest";
import { createHostMeshBridge } from "./host-mesh-bridge";
import type { NetScene } from "../graph/scene";
import type { PluginView } from "../plugins/plugin";

function fakeLane() {
  let release: () => void = () => {};
  const lane = {
    clear: vi.fn(),
    setAssetOrder: vi.fn(),
    ensureAssets: vi.fn(() => new Promise<void>((r) => { release = r; })),
    applySlotBuffer: vi.fn(),
    setScenery: vi.fn(),
    allAssetsFailed: vi.fn(() => false),
  };
  return { lane, release: () => release() };
}

const koi = { id: "koi-pond", assets: [{ id: "koi" }] } as unknown as PluginView;

describe("host mesh placement guard", () => {
  it("does not place Koi meshes before the frame is ready", async () => {
    const { lane } = fakeLane();
    const bridge = createHostMeshBridge({ hostMeshLane: lane } as unknown as NetScene, () => false);
    expect(await bridge.mountPack(koi)).toBe(false);
    expect(lane.ensureAssets).not.toHaveBeenCalled();
    expect(lane.applySlotBuffer).not.toHaveBeenCalled();
  });

  it("drops the placement when the view changed during the asset load", async () => {
    const { lane, release } = fakeLane();
    let current = true;
    const bridge = createHostMeshBridge({ hostMeshLane: lane } as unknown as NetScene, () => current);
    const p = bridge.mountPack(koi);
    current = false; // fell back to Topology while assets loaded
    release();
    expect(await p).toBe(false);
    expect(lane.applySlotBuffer).not.toHaveBeenCalled();
  });

  it("drops a stale mount superseded by a newer one", async () => {
    const { lane, release } = fakeLane();
    const bridge = createHostMeshBridge({ hostMeshLane: lane } as unknown as NetScene, () => true);
    const first = bridge.mountPack(koi);
    const firstRelease = release;
    void bridge.mountPack(null);
    firstRelease();
    expect(await first).toBe(false);
    expect(lane.applySlotBuffer).not.toHaveBeenCalled();
  });

  it("places Koi meshes once ready and current", async () => {
    const { lane, release } = fakeLane();
    const bridge = createHostMeshBridge({ hostMeshLane: lane } as unknown as NetScene, () => true);
    const p = bridge.mountPack(koi);
    release();
    expect(await p).toBe(true);
    expect(lane.applySlotBuffer).toHaveBeenCalled();
  });

  it("places meshes in the scene of the tile the sandbox drives, not the main scene", async () => {
    // Mosaic max: Koi's pane has its own NetScene; the main scene sits in Voxel's hidden pane.
    const main = fakeLane();
    const koiPane = fakeLane();
    let target = { hostMeshLane: main.lane } as unknown as NetScene;
    const bridge = createHostMeshBridge(() => target, () => true);
    target = { hostMeshLane: koiPane.lane } as unknown as NetScene;
    const p = bridge.mountPack(koi);
    koiPane.release();
    expect(await p).toBe(true);
    expect(koiPane.lane.applySlotBuffer).toHaveBeenCalled();
    expect(main.lane.applySlotBuffer).not.toHaveBeenCalled();
    expect(main.lane.ensureAssets).not.toHaveBeenCalled();
    bridge.applySlotBuffer([1, 2, 3]);
    expect(koiPane.lane.applySlotBuffer).toHaveBeenLastCalledWith([1, 2, 3]);
  });

  it("clears the old tile's lane when the driven tile changes", async () => {
    const a = fakeLane();
    const b = fakeLane();
    let target = { hostMeshLane: a.lane } as unknown as NetScene;
    const bridge = createHostMeshBridge(() => target, () => true);
    const first = bridge.mountPack(koi);
    a.release();
    await first;
    a.lane.clear.mockClear();
    target = { hostMeshLane: b.lane } as unknown as NetScene;
    const second = bridge.mountPack(koi);
    b.release();
    expect(await second).toBe(true);
    expect(a.lane.clear).toHaveBeenCalled();
    expect(b.lane.applySlotBuffer).toHaveBeenCalled();
  });

  it("main.ts binds the bridge to the driven tile's scene (mosaic max from a preview pane)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(import.meta.dirname, "main.ts"), "utf8");
    expect(src).toMatch(/createHostMeshBridge\(\(\) => sandboxDrivenScene\(\)/);
    expect(src).toMatch(/function sandboxDrivenScene\(\): NetScene \{[^}]*mosaic\.graphScene\(tile\)/);
  });

  it("2x2 then Koi full view: Koi's pane gets meshes, Voxel's hidden pane 0, and focus back leaves 0 Koi meshes", async () => {
    // Counting lane: pinned packets add meshes, clear() drops them all.
    const countingLane = () => {
      const l = { meshes: 0, ...fakeLane().lane };
      l.ensureAssets = vi.fn(async () => {});
      l.applySlotBuffer = vi.fn(() => { l.meshes++; });
      l.clear = vi.fn(() => { l.meshes = 0; });
      return l;
    };
    const voxelMain = countingLane(); // main scene, parked in Voxel's pane
    const koiPane = countingLane();
    const scenes = { main: voxelMain, "plugin:koi-pond": koiPane } as Record<string, ReturnType<typeof countingLane>>;
    let driven = "main";
    const bridge = createHostMeshBridge(() => ({ hostMeshLane: scenes[driven] }) as unknown as NetScene, () => true);
    const voxel = { id: "voxel-world" } as unknown as PluginView;
    await bridge.mountPack(voxel);
    driven = "plugin:koi-pond"; // Open full view on Koi
    expect(await bridge.mountPack(koi)).toBe(true);
    expect(koiPane.meshes).toBeGreaterThan(0);
    expect(voxelMain.meshes).toBe(0);
    driven = "main"; // focus back to Voxel
    await bridge.mountPack(voxel);
    expect(koiPane.meshes).toBe(0);
    expect(voxelMain.meshes).toBe(0);
  });
});
