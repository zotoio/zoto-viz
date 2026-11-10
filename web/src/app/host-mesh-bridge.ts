import type { PluginView } from "../plugins/plugin";
import type { VizPluginContract } from "../plugins/viz-host";
import { HostMeshLane, type HostMeshAssetDecl, type HostMeshMotionProfile } from "../graph/host-mesh-lane";
import { HOST_MESH_ENV_ROLE } from "../graph/host-mesh-env";
import { buildAquariumScenery } from "../graph/aquarium-scenery";
import { buildKoiPondScenery } from "../graph/koi-pond-scenery";
import { buildMarbleRunScenery } from "../graph/marble-run-scenery";
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
  const meshes = decls.filter((d) => d.role !== HOST_MESH_ENV_ROLE);
  const hd = new Map(meshes.filter((d) => d.id.endsWith(HD_ASSET_SUFFIX)).map((d) => [d.id, d]));
  return meshes
    .filter((d) => !d.id.endsWith(HD_ASSET_SUFFIX))
    .map((d) => {
      const alt = set === "hd" ? hd.get(d.id + HD_ASSET_SUFFIX) : undefined;
      return alt ? { ...alt, id: d.id } : d;
    });
}

/** The pack's environment image for image-based lighting; HD only, so Standard renders as before. */
export function hostMeshEnvironmentDecl(
  decls: HostMeshAssetDecl[] | undefined,
  set: HostMeshModelSet,
): HostMeshAssetDecl | null {
  if (set !== "hd") return null;
  return decls?.find((d) => d.role === HOST_MESH_ENV_ROLE) ?? null;
}

type EnvLane = Partial<Pick<HostMeshLane, "setEnvironment">>;

function startEnvironment(lane: EnvLane, packId: string, decl: HostMeshAssetDecl | null): void {
  if (decl) void lane.setEnvironment?.(packId, decl).catch(() => {});
}

/** Fin beat, turn bend and the brighter lamp are the aquarium HD set's; every other mount is the baked clip. */
export function hostMeshMotionProfile(packId: string | undefined, set: HostMeshModelSet): HostMeshMotionProfile {
  if (packId === "aquarium" && set === "hd") return "aquarium-hd";
  if (packId === "koi-pond" && set === "hd") return "koi-hd";
  return "standard";
}

export type HostMeshBridge = {
  readonly lane: HostMeshLane;
  mountPack: (spec: PluginView | null) => Promise<boolean>;
  applySlotBuffer: (data: number[]) => void;
};

/**
 * Aquarium: the Blender scape GLB (scape + fish templates) sits at the origin in tank units; the
 * scenery shows fresh or reef parts, instances the fish from the pack's slots and adds the glass,
 * bubbles and caustics.
 */
/** The lane methods a pack's fixed contents need. */
export type MeshPinLane = Pick<HostMeshLane, "applySlotBuffer" | "setScenery">;

function pinAquariumContents(lane: MeshPinLane): void {
  lane.setScenery(buildAquariumScenery().root);
  lane.applySlotBuffer(encodeHostMeshSlotPacket(0, [{ matrix: IDENTITY_MATRIX }]));
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Designer koi are ~1.6 m long; the pond camera sits about 1.7 m from the water. */
const KOI_FISH_SCALE = 0.48;

/**
 * Asset 0 = Blender scape (identity). Assets 1..3 = kohaku/showa/ogon fish seeds until
 * the pack starts writing live host-mesh packets. Pads/rocks/basin come from the scape.
 */
function pinKoiContents(lane: MeshPinLane): void {
  lane.applySlotBuffer(encodeHostMeshSlotPacket(0, [{ matrix: IDENTITY_MATRIX }]));
  const fish: [number, number, number, number, number][] = [
    [1, -0.55, 0.04, 0.15, 0.4],
    [1, 0.35, 0.05, -0.4, 2.1],
    [2, 0.1, 0.04, 0.45, -0.8],
    [2, -0.2, 0.06, -0.55, 1.4],
    [3, 0.6, 0.03, 0.2, -1.6],
    [3, -0.7, 0.05, -0.15, 0.2],
  ];
  const byAsset = new Map<number, { matrix: number[]; extras: { animTime: number; param1: number; param2: number; flags: number } }[]>();
  const push = (asset: number, matrix: number[], animTime: number) => {
    const list = byAsset.get(asset) ?? [];
    list.push({ matrix, extras: { animTime, param1: 0, param2: 0, flags: 0 } });
    byAsset.set(asset, list);
  };
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
    pinAquariumContents(lane);
  } else if (packId === "koi-pond") {
    lane.setScenery(buildKoiPondScenery().root);
    pinKoiContents(lane);
  } else if (packId === "marble-run") {
    // the Blender track sits at the origin in metres; marbles are instanced scenery fed from slots
    lane.setScenery(buildMarbleRunScenery().root);
    lane.applySlotBuffer(encodeHostMeshSlotPacket(0, [{ matrix: IDENTITY_MATRIX }]));
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
    EnvLane &
    MeshPinLane,
  spec: { id: string; assets?: HostMeshAssetDecl[] },
  stillShown: () => boolean,
  modelSet: HostMeshModelSet = "standard",
): Promise<void> {
  lane.clear();
  lane.setMotionProfile?.(hostMeshMotionProfile(spec.id, modelSet));
  const decls = spec.assets ? hostMeshDeclsForSet(spec.assets, modelSet) : undefined;
  if (!decls?.length) return;
  startEnvironment(lane, spec.id, hostMeshEnvironmentDecl(spec.assets, modelSet));
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
      startEnvironment(into, spec.id, hostMeshEnvironmentDecl(spec.assets as HostMeshAssetDecl[], set));
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
