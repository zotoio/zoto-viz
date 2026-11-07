import {
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
  maxHostMeshInstancesPerSlot,
} from "../../../sdk/host-mesh-frame";
import { KOI_SLOT, unpackKoiMeta } from "./koi-pond";

/** Must match plugin.yml `viz.hostMeshSlot` — slot 3 is reserved for follow cam. */
export const KOI_HOST_MESH_BASE_SLOT = 4;

/**
 * Must match plugin.yml `assets:` order (standard ids). Index 0 is the Blender scape
 * (pinned once by the host); live packets drive fish at 1..3.
 */
export const KOI_HOST_MESH_ASSETS = [
  "koi-pond-scape",
  "koi-kohaku",
  "koi-showa",
  "koi-ogon",
  "lily-pads",
  "pond-rocks",
] as const;

export const KOI_HOST_MESH_SLOT_COUNT = 4;
const perSlot = maxHostMeshInstancesPerSlot();

/** Pattern → fish asset index (scape is 0). */
const PATTERN_TO_ASSET: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 3,
  4: 3,
  5: 2,
};

function chunkInstances<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perSlot) out.push(items.slice(i, i + perSlot));
  return out;
}

export function writeKoiHostMeshSlots(
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

  // Pads / rocks / basin live in the Blender scape (asset 0). Packets only drive fish.
  const koiCount = Math.round(Number(slot0[KOI_SLOT.koiCount]) || 0);
  let metaIdx = 0;
  for (let fi = 0, n = 0; n < koiCount && fi + 3 < slot1.length; fi += 4, n++) {
    const x = Number(slot1[fi]) || 0;
    const wiggle = Number(slot1[fi + 1]) || 0;
    const z = Number(slot1[fi + 2]) || 0;
    const yaw = Number(slot1[fi + 3]) || 0;
    const metaPacked = Number(slot0[KOI_SLOT.koiMeta0 + metaIdx]) || 0;
    metaIdx++;
    const { pattern, vigor } = unpackKoiMeta(metaPacked);
    const assetIndex = PATTERN_TO_ASSET[pattern] ?? 1;
    const phase = clock * (0.32 + vigor * 0.12) + metaIdx * 0.37;
    push(assetIndex, hostMeshMatrixYawPos(x, 0.04 + wiggle * 0.25, z, yaw, 0.48), phase);
  }

  const packets: number[][] = [];
  for (const [assetIndex, instances] of byAsset.entries()) {
    for (const part of chunkInstances(instances)) {
      packets.push(encodeHostMeshSlotPacket(assetIndex, part));
    }
  }
  let slot = KOI_HOST_MESH_BASE_SLOT;
  for (const data of packets) {
    if (slot >= KOI_HOST_MESH_BASE_SLOT + KOI_HOST_MESH_SLOT_COUNT) break;
    writeBuffer(slot, data);
    slot += 1;
  }
}
