import {
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
  maxHostMeshInstancesPerSlot,
} from "../../../sdk/host-mesh-frame";
import { PACK_HOST_MESH_SLOT } from "../../../sdk/pack-host-mesh";
import { KOI_SLOT, unpackKoiMeta } from "./koi-pond";

/** Must match plugin.yml `assets:` order. */
export const KOI_HOST_MESH_ASSETS = [
  "koi-kohaku",
  "koi-showa",
  "koi-ogon",
  "lily-pads",
  "pond-rocks",
] as const;

export const KOI_HOST_MESH_SLOT_COUNT = 6;
const perSlot = maxHostMeshInstancesPerSlot();

const PATTERN_TO_ASSET: Record<number, number> = {
  0: 0,
  1: 0,
  2: 1,
  3: 2,
  4: 2,
  5: 1,
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

  push(4, hostMeshMatrixYawPos(0, 0, 0, 0), 0);
  push(3, hostMeshMatrixYawPos(0.55, 0.02, 0.5, 0.4), 0);

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
    const assetIndex = PATTERN_TO_ASSET[pattern] ?? 0;
    const phase = clock * (0.85 + vigor * 0.35) + metaIdx * 0.37;
    push(assetIndex, hostMeshMatrixYawPos(x, 0.08 + wiggle, z, yaw), phase);
  }

  const packets: number[][] = [];
  for (const [assetIndex, instances] of byAsset.entries()) {
    for (const part of chunkInstances(instances)) {
      packets.push(encodeHostMeshSlotPacket(assetIndex, part));
    }
  }
  let slot = PACK_HOST_MESH_SLOT;
  for (const data of packets) {
    if (slot >= PACK_HOST_MESH_SLOT + KOI_HOST_MESH_SLOT_COUNT) break;
    writeBuffer(slot, data);
    slot += 1;
  }
}
