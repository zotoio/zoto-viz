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
});
