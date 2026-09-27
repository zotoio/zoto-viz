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

/** Species index (aquarium.ts) → plugin.yml asset index. */
export const AQU_SPECIES_TO_ASSET: number[] = [7, 2, 6, 8, 5, 9];

/** Cory belly sits ~9 mm below rig origin — lift above gravel. */
const CORY_SPECIES_INDEX = 3;
const CORY_BELLY_LIFT_M = 0.009;

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

  push(1, hostMeshMatrixYawPos(0, 0, 0, 0), 0);
  push(0, hostMeshMatrixYawPos(0, 0.05, 0, 0), 0);

  const fishCount = Math.round(Number(slot0[AQU_SLOT.fishCount]) || 0);
  for (let fi = 0, n = 0; n < fishCount && fi + 3 < slot1.length; fi += 4, n++) {
    const x = Number(slot1[fi]) || 0;
    const y = Number(slot1[fi + 1]) || 0;
    const z = Number(slot1[fi + 2]) || 0;
    const yaw = Number(slot1[fi + 3]) || 0;
    const species = Math.round(Number(slot0[AQU_SLOT.fishSpecies0 + n]) || 0);
    const vigor = Number(slot0[AQU_SLOT.fishVigor0 + n]) || 0.5;
    const assetIndex = AQU_SPECIES_TO_ASSET[species] ?? 7;
    const fishY = species === CORY_SPECIES_INDEX ? y + CORY_BELLY_LIFT_M : y;
    const phase = clock * (0.9 + vigor * 0.4) + n * 0.29;
    push(assetIndex, hostMeshMatrixYawPos(x, fishY, z, yaw), phase);
  }

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
