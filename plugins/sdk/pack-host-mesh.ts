/**
 * Host mesh lane (web HostMeshLane + host-mesh-bridge): packs drive instanced GLB via a
 * dedicated buffer slot — not sandbox fetch. See docs/perf/phase2-host-models.md.
 */

import {
  PACK_MODEL_FLAG_CONFIGURED,
  PACK_MODEL_FLAG_LOADED,
  parsePackModelPath,
  type PackModelSlotState,
  useProceduralArt,
} from "./pack-model-slot";
import {
  canAddBatchBuffer,
  type VizWriteBatchReserve,
  vizWriteBatchBufferBytes,
  vizWriteBatchParticlesBytes,
  vizWriteBatchUniformBytes,
} from "./viz-write-batch-caps";

/** Default mesh matrix slot when sim data uses 0–2 (declare `viz.hostMeshSlot` in plugin.yml). */
export const PACK_HOST_MESH_SLOT = 3;

export const HOST_MESH_MATRIX_FLOATS = 16;

export type HostMeshAssetRef = { id: string; path: string };

export function normalizePackAssetPath(p: string): string {
  return p.replace(/^\/+/, "").trim().toLowerCase();
}

/** True when `modelGlb` (or modelSlot) matches a declared plugin.yml asset id or path. */
export function hostMeshAssetMatchesConfig(
  cfg: Record<string, string | undefined> | null | undefined,
  asset: HostMeshAssetRef | undefined,
): boolean {
  const path = parsePackModelPath(cfg);
  if (!path || !asset) return false;
  const want = normalizePackAssetPath(path);
  return want === normalizePackAssetPath(asset.path) || want === normalizePackAssetPath(asset.id);
}

/** Mark slot state as host-mesh-driven (GLB on host lane, shader may skip procedural). */
export function applyHostMeshAssetReady(state: PackModelSlotState): PackModelSlotState {
  if (!state.path) return state;
  return {
    ...state,
    flags: PACK_MODEL_FLAG_LOADED | PACK_MODEL_FLAG_CONFIGURED,
    scale: state.scale,
  };
}

export function shouldWriteHostMeshMatrix(state: PackModelSlotState): boolean {
  return !useProceduralArt(state) && state.path.length > 0;
}

export function hostMeshModelsEnabled(cfg: Record<string, string | undefined> | null | undefined): boolean {
  const path = parsePackModelPath(cfg);
  if (!path || path === "off" || path === "none" || path === "procedural") return false;
  if (path === "host" || path === "auto") return true;
  return path.endsWith(".glb");
}

export function syncPackModelHostMeshAssets(
  modelSlot: { setHostMeshReady(): void; setConfig(cfg: Record<string, string | undefined> | null | undefined): void },
  cfg: Record<string, string | undefined> | null | undefined,
): void {
  modelSlot.setConfig(cfg);
  if (hostMeshModelsEnabled(cfg)) modelSlot.setHostMeshReady();
}

/** Column-major 4×4 for HostMeshLane (demo-style spin + scale). */
export function hostMeshMatrixYSpin(clock: number, scale = 1, tz = -1.2): number[] {
  const s = scale * (0.35 + Math.sin(clock * 0.7) * 0.1);
  const c = Math.cos(clock * 0.4);
  const si = Math.sin(clock * 0.4);
  return [
    s * c, 0, s * si, 0,
    0, s, 0, 0,
    -s * si, 0, s * c, 0,
    0, 0, tz, 1,
  ];
}

export function writeHostMeshMatrixSlot(
  writeBuffer: (slot: number, data: number[] | Float32Array) => void,
  slot: number,
  matrix: number[],
): void {
  if (matrix.length < HOST_MESH_MATRIX_FLOATS) return;
  writeBuffer(slot, matrix);
}

/**
 * Emit host-mesh slot packets within the sandbox frame batch budget (32 messages / 4096 B).
 * Stops before exceeding caps given other writes already reserved for the same frame.
 */
export function flushHostMeshSlotWrites(
  writeBuffer: (slot: number, data: number[] | Float32Array) => void,
  baseSlot: number,
  maxSlotCount: number,
  packets: number[][],
  frameReserve: VizWriteBatchReserve = { messages: 0, bytes: 0 },
): number {
  let slot = baseSlot;
  let reserve = { ...frameReserve };
  let written = 0;
  for (const data of packets) {
    if (written >= maxSlotCount) break;
    if (!canAddBatchBuffer(reserve, data.length)) break;
    writeBuffer(slot, data);
    reserve = {
      messages: reserve.messages + 1,
      bytes: reserve.bytes + vizWriteBatchBufferBytes(data.length),
    };
    slot += 1;
    written += 1;
  }
  return written;
}

/** Reserve budget for non–host-mesh writes in the same sandbox frame batch. */
export function hostMeshFrameReserveAfterSimWrites(args: {
  simBufferCount?: number;
  simBufferFloats?: number;
  uniformCount?: number;
  particleFloats?: number;
}): VizWriteBatchReserve {
  const simN = args.simBufferCount ?? 3;
  const simFloats = args.simBufferFloats ?? 64;
  let messages = simN;
  let bytes = simN * vizWriteBatchBufferBytes(simFloats);
  const uniformCount = args.uniformCount ?? 4;
  messages += uniformCount;
  bytes += uniformCount * vizWriteBatchUniformBytes();
  const pf = args.particleFloats ?? 0;
  if (pf > 0) {
    messages += 1;
    bytes += vizWriteBatchParticlesBytes(pf);
  }
  return { messages, bytes };
}
