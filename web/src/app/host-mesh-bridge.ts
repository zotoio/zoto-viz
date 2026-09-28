import type { PluginView } from "../plugins/plugin";
import type { VizPluginContract } from "../plugins/viz-host";
import { HostMeshLane, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
import { buildAquariumTank } from "../graph/aquarium-tank";
import {
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
} from "../../../plugins/sdk/host-mesh-frame";
import type { NetScene } from "../graph/scene";

const DEFAULT_HOST_MESH_SLOT = 2;

export function hostMeshBufferSlot(contract: VizPluginContract | undefined): number {
  return contract?.hostMeshSlot ?? DEFAULT_HOST_MESH_SLOT;
}

export function hostMeshSlotCount(contract: VizPluginContract | undefined): number {
  const n = contract?.hostMeshSlotCount ?? 1;
  return Math.max(1, Math.min(6, Math.floor(n)));
}

export function tryApplyHostMeshBridge(
  bridge: HostMeshBridge,
  spec: PluginView | null,
  contract: VizPluginContract | undefined,
  slot: number,
  data: number[],
): void {
  if (!spec?.assets?.length) return;
  const base = hostMeshBufferSlot(contract);
  const count = hostMeshSlotCount(contract);
  if (slot < base || slot >= base + count) return;
  bridge.applySlotBuffer(data);
}

export type HostMeshBridge = {
  lane: HostMeshLane;
  mountPack: (spec: PluginView | null) => Promise<boolean>;
  applySlotBuffer: (data: number[]) => void;
};

/** Gravel bed is ~0.62 m wide; scale fills the 2.44 m tank floor. Plants stay under the lid. */
const AQUARIUM_SUBSTRATE_SCALE = 3.5;
const AQUARIUM_PLANT_SCALE = 2.6;
/** Designer fish are about 8–20 cm; this sits them in the tank without filling it. */
const AQUARIUM_FISH_SCALE = 1.35;

function pinAquariumContents(lane: HostMeshLane): void {
  const plant = (x: number, z: number, yaw: number) => ({
    matrix: hostMeshMatrixYawPos(x, -0.74, z, yaw, AQUARIUM_PLANT_SCALE),
  });
  lane.applySlotBuffer(encodeHostMeshSlotPacket(1, [{
    matrix: hostMeshMatrixYawPos(0, -0.78, 0, 0, AQUARIUM_SUBSTRATE_SCALE),
  }]));
  lane.applySlotBuffer(encodeHostMeshSlotPacket(0, [
    plant(-0.55, 0.15, 0.4),
    plant(0.2, -0.25, 1.1),
    plant(0.65, 0.35, -0.6),
  ]));
  // One of each shipped species. flags 1 drifts them until sandbox fish packets take over.
  const fish: [number, number, number, number, number][] = [
    [7, -0.85, 0.05, 0.35, 0.4],
    [7, -0.55, 0.22, 0.05, 1.1],
    [2, -0.15, 0.18, -0.15, 2.4],
    [6, 0.75, 0.02, 0.4, -0.6],
    [3, 0.15, 0.32, 0.15, 1.8],
    [8, 0.45, -0.62, 0.05, 0.2],
    [5, 0.85, 0.12, -0.25, -1.4],
    [9, -0.35, -0.05, -0.55, 0.8],
    [4, 0.4, 0.28, 0.45, -2.2],
  ];
  const byAsset = new Map<number, { matrix: number[]; extras: { animTime: number; param1: number; param2: number; flags: number } }[]>();
  fish.forEach(([asset, x, y, z, yaw], i) => {
    const list = byAsset.get(asset) ?? [];
    list.push({
      matrix: hostMeshMatrixYawPos(x, y, z, yaw, AQUARIUM_FISH_SCALE),
      extras: { animTime: i * 0.17, param1: i * 0.7, param2: 0.28 + (i % 4) * 0.06, flags: 1 },
    });
    byAsset.set(asset, list);
  });
  for (const [asset, instances] of byAsset) {
    lane.applySlotBuffer(encodeHostMeshSlotPacket(asset, instances));
  }
}

export function createHostMeshBridge(scene: NetScene): HostMeshBridge {
  const lane = scene.hostMeshLane;

  return {
    lane,
    async mountPack(spec) {
      lane.clear();
      if (!spec?.assets?.length) return true;
      const decls = spec.assets as HostMeshAssetDecl[];
      lane.setAssetOrder(decls.map((d) => d.id));
      await lane.ensureAssets(spec.id, decls);
      if (spec.id === "aquarium") {
        lane.setScenery(buildAquariumTank());
        pinAquariumContents(lane);
      }
      return !lane.allAssetsFailed();
    },
    applySlotBuffer(data) {
      lane.applySlotBuffer(data);
    },
  };
}
