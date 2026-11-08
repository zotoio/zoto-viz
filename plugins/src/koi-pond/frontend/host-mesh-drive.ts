import {
  encodeHostMeshSlotPacketV3Mixed,
  hostMeshMatrixYawPos,
  HOST_MESH_V3_MAX_INSTANCES,
} from "../../../sdk/host-mesh-frame";
import { KOI_SLOT, MAX_KOI, unpackKoiMeta } from "./koi-pond";

/** Must match plugin.yml `viz.hostMeshSlot` — viz buffer slot 3 is follow cam; mesh packets 4–7. */
export const KOI_HOST_MESH_BASE_SLOT = 4;

/** Four mesh buffers (slots 4–7) under maxBuffers: 8. */
export const KOI_HOST_MESH_SLOT_COUNT = 4;

export const KOI_HOST_MESH_MAX_INSTANCES = MAX_KOI;

const FISH_ASSET_INDICES = [1, 2, 3] as const;

/** Pattern → fish asset index (scape is 0). */
const PATTERN_TO_ASSET: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 3,
  4: 3,
  5: 2,
};

export type KoiMeshRow = {
  assetIndex: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  animTime: number;
};

/** Build drawable rows for every simulated koi (up to {@link MAX_KOI}). */
export function collectKoiMeshRows(
  slot0: ArrayLike<number>,
  slot1: ArrayLike<number>,
  clock: number,
): KoiMeshRow[] {
  const rows: KoiMeshRow[] = [];
  const koiCount = Math.round(Number(slot0[KOI_SLOT.koiCount]) || 0);
  let metaIdx = 0;
  for (let fi = 0, n = 0; n < koiCount && n < MAX_KOI && fi + 3 < slot1.length; fi += 4, n++) {
    const x = Number(slot1[fi]) || 0;
    const wiggle = Number(slot1[fi + 1]) || 0;
    const z = Number(slot1[fi + 2]) || 0;
    const yaw = Number(slot1[fi + 3]) || 0;
    const metaPacked = Number(slot0[KOI_SLOT.koiMeta0 + metaIdx]) || 0;
    metaIdx++;
    const { pattern, vigor } = unpackKoiMeta(metaPacked);
    const assetIndex = PATTERN_TO_ASSET[pattern] ?? 1;
    const phase = clock * (0.32 + vigor * 0.12) + metaIdx * 0.37;
    const m = hostMeshMatrixYawPos(x, 0.04 + wiggle * 0.25, z, yaw, 0.48);
    rows.push({
      assetIndex,
      x: m[12]!,
      y: m[13]!,
      z: m[14]!,
      yaw,
      scale: 0.48,
      animTime: phase,
    });
  }
  return rows;
}

function chunkV3<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += HOST_MESH_V3_MAX_INSTANCES) {
    out.push(items.slice(i, i + HOST_MESH_V3_MAX_INSTANCES));
  }
  return out;
}

export function writeKoiHostMeshSlots(
  writeBuffer: (slot: number, data: number[] | Float32Array) => void,
  slot0: ArrayLike<number>,
  slot1: ArrayLike<number>,
  clock: number,
): void {
  const rows = collectKoiMeshRows(slot0, slot1, clock);
  const chunks = chunkV3(rows);
  if (chunks.length > KOI_HOST_MESH_SLOT_COUNT) {
    throw new Error(
      `koi host mesh needs ${chunks.length} v3 packets but only ${KOI_HOST_MESH_SLOT_COUNT} mesh slots`,
    );
  }
  let slot = KOI_HOST_MESH_BASE_SLOT;
  for (let ci = 0; ci < chunks.length; ci++) {
    const part = chunks[ci]!;
    const data = encodeHostMeshSlotPacketV3Mixed(
      part.map((r) => ({
        assetIndex: r.assetIndex,
        x: r.x,
        y: r.y,
        z: r.z,
        yaw: r.yaw,
        scale: r.scale,
        animTime: r.animTime,
      })),
      { flush: ci === chunks.length - 1 },
    );
    writeBuffer(slot, data);
    slot += 1;
  }
}
