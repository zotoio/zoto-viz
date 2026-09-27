import type { PluginView } from "../plugins/plugin";
import { HostMeshLane, parseHostMeshInstances, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
import type { NetScene } from "../graph/scene";

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
