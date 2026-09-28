import {
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
  maxHostMeshInstancesPerSlot,
} from "../../../sdk/host-mesh-frame";
import { PACK_HOST_MESH_SLOT } from "../../../sdk/pack-host-mesh";
import { AQU_SLOT } from "./aquarium";

export const AQU_HOST_MESH_ASSETS = [
  "aquarium-plants",
  "aquarium-substrate",
  "fish-angelfish",
  "fish-betta",
  "fish-clownfish",
  "fish-discus",
  "fish-guppy",
  "fish-neon-tetra",
  "fish-cory",
  "fish-cichlid",
] as const;

export const AQU_HOST_MESH_SLOT_COUNT = 6;
const perSlot = maxHostMeshInstancesPerSlot();

/**
 * Freshwater species index → plugin.yml asset index.
 * neon, angel, guppy, cory, discus, cichlid, betta.
 */
export const AQU_SPECIES_TO_ASSET: number[] = [7, 2, 6, 8, 5, 9, 3];

/**
 * Reef species index → plugin.yml asset index.
 * clown, tang (angelfish GLB), damsel (neon), goby (cory), wrasse (guppy), anemone (discus).
 * Tang, damsel, goby, wrasse, and anemone have no dedicated mesh; the closest shipped GLB fills the slot.
 */
export const AQU_REEF_SPECIES_TO_ASSET: number[] = [4, 2, 7, 8, 6, 5];

/** Designer fish are about 8–20 cm; this sits them in the tank without filling it. */
const FISH_SCALE = 1.35;

/** Cory belly sits ~9 mm below rig origin — lift above gravel (scaled with the mesh). */
const CORY_SPECIES_INDEX = 3;
const CORY_BELLY_LIFT_M = 0.009;

function assetForSpecies(species: number, reef: boolean): number {
  const table = reef ? AQU_REEF_SPECIES_TO_ASSET : AQU_SPECIES_TO_ASSET;
  return table[species] ?? (reef ? 4 : 7);
}

function chunkInstances<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perSlot) out.push(items.slice(i, i + perSlot));
  return out;
}

export function writeAquariumHostMeshSlots(
  writeBuffer: (slot: number, data: number[] | Float32Array) => void,
  slot0: ArrayLike<number>,
  slot1: ArrayLike<number>,
  clock: number,
): void {
  const byAsset = new Map<number, { matrix: number[]; extras: { animTime: number; param1: number; param2: number; flags: number } }[]>();
  const push = (assetIndex: number, matrix: number[], animTime: number) => {
    const list = byAsset.get(assetIndex) ?? [];
    list.push({ matrix, extras: { animTime, param1: 0, param2: 0, flags: 0 } });
    byAsset.set(assetIndex, list);
  };

  const fishCount = Math.round(Number(slot0[AQU_SLOT.fishCount]) || 0);
  const reef = Number(slot0[AQU_SLOT.water]) > 0.5;
  for (let fi = 0, n = 0; n < fishCount && fi + 3 < slot1.length; fi += 4, n++) {
    const x = Number(slot1[fi]) || 0;
    const y = Number(slot1[fi + 1]) || 0;
    const z = Number(slot1[fi + 2]) || 0;
    const yaw = Number(slot1[fi + 3]) || 0;
    const species = Math.round(Number(slot0[AQU_SLOT.fishSpecies0 + n]) || 0);
    const vigor = Number(slot0[AQU_SLOT.fishVigor0 + n]) || 0.5;
    const assetIndex = assetForSpecies(species, reef);
    const fishY = species === CORY_SPECIES_INDEX ? y + CORY_BELLY_LIFT_M * FISH_SCALE : y;
    const phase = clock * (0.9 + vigor * 0.4) + n * 0.29;
    push(assetIndex, hostMeshMatrixYawPos(x, fishY, z, yaw, FISH_SCALE), phase);
  }

  // Plants and gravel are pinned by the host when the pack mounts. These slots
  // are only the school, so a full tank of fish does not drop the scenery.
  const packets: number[][] = [];
  for (const [assetIndex, instances] of byAsset.entries()) {
    for (const part of chunkInstances(instances)) {
      packets.push(encodeHostMeshSlotPacket(assetIndex, part));
    }
  }
  let slot = PACK_HOST_MESH_SLOT;
  for (const data of packets) {
    if (slot >= PACK_HOST_MESH_SLOT + AQU_HOST_MESH_SLOT_COUNT) break;
    writeBuffer(slot, data);
    slot += 1;
  }
}
