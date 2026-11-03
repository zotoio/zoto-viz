import type { PluginView } from "../plugins/plugin";
import type { VizPluginContract } from "../plugins/viz-host";
import { HostMeshLane, type HostMeshAssetDecl, type HostMeshMotionProfile } from "../graph/host-mesh-lane";
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

/** Suffix of an asset id that is the HD alternative of the asset without it (`koi-ogon-hd`). */
export const HD_ASSET_SUFFIX = "-hd";
export type HostMeshModelSet = "standard" | "hd";

export function hostMeshModelSet(config: Record<string, string | undefined> | undefined): HostMeshModelSet {
  return config?.modelSet === "hd" ? "hd" : "standard";
}

/**
 * The asset list a lane loads for `set`. HD entries never take a slot of their own: the list keeps
 * the standard ids and order (packs address meshes by that index), and with `hd` each standard
 * entry that has an `<id>-hd` sibling loads the sibling's file under the standard id.
 */
export function hostMeshDeclsForSet(decls: HostMeshAssetDecl[], set: HostMeshModelSet): HostMeshAssetDecl[] {
  const hd = new Map(decls.filter((d) => d.id.endsWith(HD_ASSET_SUFFIX)).map((d) => [d.id, d]));
  return decls
    .filter((d) => !d.id.endsWith(HD_ASSET_SUFFIX))
    .map((d) => {
      const alt = set === "hd" ? hd.get(d.id + HD_ASSET_SUFFIX) : undefined;
      return alt ? { ...alt, id: d.id } : d;
    });
}

/** Fin beat, turn bend and the brighter lamp are the aquarium HD set's; every other mount is the baked clip. */
export function hostMeshMotionProfile(packId: string | undefined, set: HostMeshModelSet): HostMeshMotionProfile {
  return packId === "aquarium" && set === "hd" ? "aquarium-hd" : "standard";
}

export type HostMeshBridge = {
  readonly lane: HostMeshLane;
  mountPack: (spec: PluginView | null) => Promise<boolean>;
  applySlotBuffer: (data: number[]) => void;
};

/** Glass inner half-width and the back pane / front lip z (aquarium-tank.ts), and the tank floor y. */
const AQ_INNER_X = 1.2;
const AQ_BACK_Z = -1.0;
const AQ_FRONT_Z = 1.0;
const AQ_FLOOR_Y = -0.805;

/**
 * Measured bounds of the shipped gravel bed and plant clump GLBs (x0, x1, z0, z1, top), metres.
 * HD swaps both models for scans of a different footprint, so each set is fitted on its own.
 */
type Bounds = { x0: number; x1: number; z0: number; z1: number; top: number };
const AQ_BOUNDS: Record<HostMeshModelSet, { substrate: Bounds; plants: Bounds }> = {
  standard: {
    substrate: { x0: -0.31, x1: 0.31, z0: -0.16, z1: 0.16, top: 0.23 },
    plants: { x0: -0.304, x1: 0.326, z0: -0.165, z1: 0.159, top: 0.398 },
  },
  hd: {
    substrate: { x0: -0.332, x1: 0.31, z0: -0.229, z1: 0.16, top: 0.13 },
    plants: { x0: -0.51, x1: 0.551, z0: -0.401, z1: 0.363, top: 0.42 },
  },
};
const AQ_PLANT_SCALE: Record<HostMeshModelSet, number> = { standard: 2.2, hd: 1.25 };

/** Gravel stretched (x, z) to cover the whole floor, glass to glass; height keeps the Standard look. */
export function aquariumSubstrateMatrix(set: HostMeshModelSet): number[] {
  const b = AQ_BOUNDS[set].substrate;
  const sx = (AQ_INNER_X * 2) / (b.x1 - b.x0);
  const sz = (AQ_FRONT_Z - AQ_BACK_Z) / (b.z1 - b.z0);
  const sy = 3.5;
  const tx = -((b.x0 + b.x1) / 2) * sx;
  const tz = (AQ_FRONT_Z + AQ_BACK_Z) / 2 - ((b.z0 + b.z1) / 2) * sz;
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, tx, AQ_FLOOR_Y, tz, 1];
}

/** Plant clumps placed so every leaf stays inside the glass at any yaw (radius = farthest corner). */
export function aquariumPlantPlacements(set: HostMeshModelSet): { x: number; z: number; yaw: number; scale: number; radius: number }[] {
  const b = AQ_BOUNDS[set].plants;
  const scale = AQ_PLANT_SCALE[set];
  const radius = Math.hypot(Math.max(-b.x0, b.x1), Math.max(-b.z0, b.z1)) * scale;
  const want: [number, number, number][] = [[-0.5, -0.3, 0.4], [0.15, -0.45, 1.1], [0.55, -0.05, -0.6]];
  return want.map(([x, z, yaw]) => ({
    x: Math.max(-AQ_INNER_X + radius, Math.min(AQ_INNER_X - radius, x)),
    z: Math.max(AQ_BACK_Z + radius, Math.min(AQ_FRONT_Z - radius, z)),
    yaw,
    scale,
    radius,
  }));
}
/** Designer fish are about 8–20 cm; this sits them in the tank without filling it. */
const AQUARIUM_FISH_SCALE = 1.35;

/** The lane methods a pack's fixed contents need. */
export type MeshPinLane = Pick<HostMeshLane, "applySlotBuffer" | "setScenery">;

function pinAquariumContents(lane: MeshPinLane, set: HostMeshModelSet): void {
  lane.applySlotBuffer(encodeHostMeshSlotPacket(1, [{ matrix: aquariumSubstrateMatrix(set) }]));
  lane.applySlotBuffer(encodeHostMeshSlotPacket(0, aquariumPlantPlacements(set).map((p) => ({
    matrix: hostMeshMatrixYawPos(p.x, -0.76, p.z, p.yaw, p.scale),
  }))));
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

/** Designer koi are ~1.6 m long; the pond camera sits about 1.7 m from the water. */
const KOI_FISH_SCALE = 0.48;
const KOI_LILY_SCALE = 0.32;
const KOI_ROCK_SCALE = 0.9;

function pinKoiContents(lane: MeshPinLane): void {
  const fish: [number, number, number, number, number][] = [
    [0, -0.55, 0.04, 0.15, 0.4],
    [0, 0.35, 0.05, -0.4, 2.1],
    [1, 0.1, 0.04, 0.45, -0.8],
    [1, -0.2, 0.06, -0.55, 1.4],
    [2, 0.6, 0.03, 0.2, -1.6],
    [2, -0.7, 0.05, -0.15, 0.2],
  ];
  const byAsset = new Map<number, { matrix: number[]; extras: { animTime: number; param1: number; param2: number; flags: number } }[]>();
  const push = (asset: number, matrix: number[], animTime: number) => {
    const list = byAsset.get(asset) ?? [];
    list.push({ matrix, extras: { animTime, param1: 0, param2: 0, flags: 0 } });
    byAsset.set(asset, list);
  };
  push(4, hostMeshMatrixYawPos(0, 0, 0, 0.3, KOI_ROCK_SCALE), 0);
  const pads: [number, number, number][] = [
    [0.15, 0.35, 0.2],
    [-0.45, -0.2, 1.1],
    [0.5, -0.45, -0.4],
    [-0.15, 0.6, 2.2],
  ];
  for (const [x, z, yaw] of pads) push(3, hostMeshMatrixYawPos(x, 0.01, z, yaw, KOI_LILY_SCALE), 0);
  fish.forEach(([asset, x, y, z, yaw], i) => {
    push(asset, hostMeshMatrixYawPos(x, y, z, yaw, KOI_FISH_SCALE), i * 0.37);
  });
  for (const [asset, instances] of byAsset) {
    lane.applySlotBuffer(encodeHostMeshSlotPacket(asset, instances));
  }
}

/** A pack's shipped scenery and fixed contents, pinned into a lane with no sandbox packets. */
export function pinPackContents(lane: MeshPinLane, packId: string, set: HostMeshModelSet = "standard"): void {
  if (packId === "aquarium") {
    lane.setScenery(buildAquariumTank());
    pinAquariumContents(lane, set);
  } else if (packId === "koi-pond") {
    pinKoiContents(lane);
  }
}

/**
 * A mosaic pane that shows a pack mounts that pack's host meshes into the pane's own scene.
 * Without this a pane that is not the live view stays a dark field until its view is promoted
 * (the live path only runs in applyMode). `stillShown` guards against the pane being rebound
 * while its assets load.
 */
export async function mountPaneHostMeshes(
  lane: Pick<HostMeshLane, "clear" | "setAssetOrder" | "ensureAssets"> &
    Partial<Pick<HostMeshLane, "setMotionProfile">> &
    MeshPinLane,
  spec: { id: string; assets?: HostMeshAssetDecl[] },
  stillShown: () => boolean,
  modelSet: HostMeshModelSet = "standard",
): Promise<void> {
  lane.clear();
  lane.setMotionProfile?.(hostMeshMotionProfile(spec.id, modelSet));
  const decls = spec.assets ? hostMeshDeclsForSet(spec.assets, modelSet) : undefined;
  if (!decls?.length) return;
  lane.setAssetOrder(decls.map((d) => d.id));
  await lane.ensureAssets(spec.id, decls);
  if (!stillShown()) {
    lane.clear();
    return;
  }
  pinPackContents(lane, spec.id, modelSet);
}

/**
 * `canPlace(packId)` gates host meshes: the pack must still be the current view and, for a
 * sandboxed pack, its frame must have reached `ready`. Checked before and after the asset
 * await so a slow load never pins fish onto a view that has moved on.
 */
/**
 * `target` may be a getter: in a mosaic the sandbox drives one tile, and that tile's
 * pane has its own NetScene. Meshes go into the scene on screen for the driven tile,
 * never into the main scene parked in another (possibly hidden) pane.
 */
export function createHostMeshBridge(
  target: NetScene | (() => NetScene),
  canPlace: (packId: string) => boolean = () => true,
  modelSetFor: (spec: PluginView) => HostMeshModelSet = () => "standard",
): HostMeshBridge {
  const sceneOf = typeof target === "function" ? target : () => target;
  // Resolved lazily: the getter may read state that is set up after the bridge.
  let current: HostMeshLane | null = null;
  const laneNow = (): HostMeshLane => (current ??= sceneOf().hostMeshLane);
  let gen = 0;

  return {
    get lane() {
      return laneNow();
    },
    async mountPack(spec) {
      const mine = ++gen;
      current?.clear();
      current = sceneOf().hostMeshLane;
      const lane = current;
      lane.clear();
      const set = spec ? modelSetFor(spec) : "standard";
      lane.setMotionProfile?.(hostMeshMotionProfile(spec?.id, set));
      if (!spec?.assets?.length) return true;
      if (!canPlace(spec.id)) return false;
      const decls = hostMeshDeclsForSet(spec.assets as HostMeshAssetDecl[], set);
      const into = lane;
      into.setAssetOrder(decls.map((d) => d.id));
      await into.ensureAssets(spec.id, decls);
      if (mine !== gen || into !== current) return false;
      if (!canPlace(spec.id)) {
        into.clear();
        return false;
      }
      pinPackContents(into, spec.id, set);
      return !into.allAssetsFailed();
    },
    applySlotBuffer(data) {
      laneNow().applySlotBuffer(data);
    },
  };
}
