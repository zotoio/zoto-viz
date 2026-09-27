import type { PluginView } from "../plugins/plugin";
import type { VizPluginContract } from "../plugins/viz-host";
import { HostMeshLane, parseHostMeshInstances, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
import type { NetScene } from "../graph/scene";

const DEFAULT_HOST_MESH_SLOT = 2;

export function hostMeshBufferSlot(contract: VizPluginContract | undefined): number {
  return contract?.hostMeshSlot ?? DEFAULT_HOST_MESH_SLOT;
}

export function tryApplyHostMeshBridge(
  bridge: HostMeshBridge,
  spec: PluginView | null,
  contract: VizPluginContract | undefined,
  slot: number,
  data: number[],
): void {
  const asset = spec?.assets?.[0];
  if (!asset?.id) return;
  if (slot !== hostMeshBufferSlot(contract)) return;
  bridge.applySlot(slot, data, asset.id);
}

export type HostMeshBridge = {
  lane: HostMeshLane;
  mountPack: (spec: PluginView | null) => Promise<void>;
  applySlot: (slot: number, data: number[], assetId: string) => void;
};

export function createHostMeshBridge(scene: NetScene): HostMeshBridge {
  const lane = scene.hostMeshLane;

  return {
    lane,
    async mountPack(spec) {
      lane.clear();
      if (!spec?.assets?.length) return;
      const decls = spec.assets as HostMeshAssetDecl[];
      await lane.ensureAssets(spec.id, decls);
    },
    applySlot(_slot, data, assetId) {
      const frame = parseHostMeshInstances(assetId, data);
      if (frame) lane.applyInstances([frame]);
    },
  };
}
