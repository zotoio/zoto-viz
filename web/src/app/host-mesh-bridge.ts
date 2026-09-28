import type { PluginView } from "../plugins/plugin";
import type { VizPluginContract } from "../plugins/viz-host";
import { HostMeshLane, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
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
      return !lane.allAssetsFailed();
    },
    applySlotBuffer(data) {
      lane.applySlotBuffer(data);
    },
  };
}
