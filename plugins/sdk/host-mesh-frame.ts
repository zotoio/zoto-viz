/**
 * Host mesh lane slot packet (v2). Each sandbox writeBuffer(hostMeshSlot+N, data) carries
 * one asset draw batch (≤3 instances in a 64-float slot).
 */

export const HOST_MESH_FRAME_V2 = 2;
/** Legacy single-asset 16-float matrix (host-mesh-demo). */
export const HOST_MESH_FRAME_V1 = 1;

export const HOST_MESH_MATRIX_FLOATS = 16;
export const HOST_MESH_EXTRAS_FLOATS = 4;
export const HOST_MESH_INSTANCE_STRIDE = HOST_MESH_MATRIX_FLOATS + HOST_MESH_EXTRAS_FLOATS;
export const HOST_MESH_HEADER_FLOATS = 3;

export type HostMeshInstanceExtras = {
  animTime: number;
  /** Wheel spin (rad) or unused. */
  param1: number;
  /** Booster flame scale 0..1 or unused. */
  param2: number;
  flags: number;
};

export type HostMeshSlotPacket = {
  version: number;
  assetIndex: number;
  instances: { matrix: Float32Array; extras: HostMeshInstanceExtras }[];
};

export function maxHostMeshInstancesPerSlot(slotFloats = 64): number {
  const room = slotFloats - HOST_MESH_HEADER_FLOATS;
  return Math.max(0, Math.floor(room / HOST_MESH_INSTANCE_STRIDE));
}

export function encodeHostMeshSlotPacket(
  assetIndex: number,
  instances: { matrix: ArrayLike<number>; extras?: Partial<HostMeshInstanceExtras> }[],
): number[] {
  const out: number[] = [
    HOST_MESH_FRAME_V2,
    assetIndex,
    instances.length,
  ];
  for (const inst of instances) {
    for (let i = 0; i < HOST_MESH_MATRIX_FLOATS; i++) {
      out.push(Number(inst.matrix[i]) || 0);
    }
    const e = inst.extras ?? {};
    out.push(e.animTime ?? 0, e.param1 ?? 0, e.param2 ?? 0, e.flags ?? 0);
  }
  return out;
}

export function decodeHostMeshSlotPacket(
  data: ArrayLike<number>,
  maxInstances = maxHostMeshInstancesPerSlot(),
): HostMeshSlotPacket | null {
  if (data.length < HOST_MESH_HEADER_FLOATS) return null;
  const version = Math.round(Number(data[0]));
  if (version === HOST_MESH_FRAME_V2) {
    const assetIndex = Math.round(Number(data[1]));
    const count = Math.min(maxInstances, Math.round(Number(data[2])));
    const need = HOST_MESH_HEADER_FLOATS + count * HOST_MESH_INSTANCE_STRIDE;
    if (data.length < need || count < 0) return null;
    const instances: HostMeshSlotPacket["instances"] = [];
    let o = HOST_MESH_HEADER_FLOATS;
    for (let i = 0; i < count; i++) {
      const matrix = new Float32Array(HOST_MESH_MATRIX_FLOATS);
      for (let j = 0; j < HOST_MESH_MATRIX_FLOATS; j++) matrix[j] = Number(data[o + j]) || 0;
      o += HOST_MESH_MATRIX_FLOATS;
      instances.push({
        matrix,
        extras: {
          animTime: Number(data[o]) || 0,
          param1: Number(data[o + 1]) || 0,
          param2: Number(data[o + 2]) || 0,
          flags: Number(data[o + 3]) || 0,
        },
      });
      o += HOST_MESH_EXTRAS_FLOATS;
    }
    return { version, assetIndex, instances };
  }
  if (data.length >= HOST_MESH_MATRIX_FLOATS) {
    const matrix = new Float32Array(HOST_MESH_MATRIX_FLOATS);
    for (let i = 0; i < HOST_MESH_MATRIX_FLOATS; i++) matrix[i] = Number(data[i]) || 0;
    return {
      version: HOST_MESH_FRAME_V1,
      assetIndex: 0,
      instances: [{ matrix, extras: { animTime: 0, param1: 0, param2: 0, flags: 0 } }],
    };
  }
  return null;
}

/** Column-major 4×4 from Y-up yaw (radians) and translation (metres). */
export function hostMeshMatrixYawPos(x: number, y: number, z: number, yaw: number, scale = 1): number[] {
  const c = Math.cos(yaw) * scale;
  const s = Math.sin(yaw) * scale;
  return [
    c, 0, s, 0,
    0, scale, 0, 0,
    -s, 0, c, 0,
    x, y, z, 1,
  ];
}
