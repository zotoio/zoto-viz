import {
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
  maxHostMeshInstancesPerSlot,
} from "../../../sdk/host-mesh-frame";
import { PACK_HOST_MESH_SLOT } from "../../../sdk/pack-host-mesh";
import { RCS_BALL_BASE, RCS_CAR0, RCS_CAR_STRIDE, RCS_MAX_CARS } from "./pack";
import { rcsCarWheelSpinRad } from "./match";

/** Must match plugin.yml `assets:` order. */
export const RCS_HOST_MESH_ASSETS = ["rocket-car", "rocket-car-blue", "soccer-ball"] as const;
export const RCS_HOST_MESH_ASSET = { id: "rocket-car", path: "assets/rocket-car.glb" };

export const RCS_HOST_MESH_MAX_CARS = 8;
export const RCS_HOST_MESH_SLOT_COUNT = 4;

const CAR_BODY_Y = 0.38;
const perSlot = maxHostMeshInstancesPerSlot();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type CarInst = {
  matrix: number[];
  extras: { animTime: number; param1: number; param2: number; flags: number };
};

function readCar(slot1: number[], i: number): CarInst | null {
  const o = RCS_CAR0 + i * RCS_CAR_STRIDE;
  if (o + 8 > slot1.length) return null;
  const x = slot1[o]!;
  const y = slot1[o + 1]!;
  const z = slot1[o + 2]!;
  const yaw = slot1[o + 3]!;
  const boost = slot1[o + 5]!;
  const team = Math.round(slot1[o + 7]!);
  return {
    matrix: hostMeshMatrixYawPos(x, y > 0.05 ? y : CAR_BODY_Y, z, yaw),
    extras: {
      animTime: 0,
      param1: rcsCarWheelSpinRad(i),
      param2: boost,
      flags: team,
    },
  };
}

export function writeRcsHostMeshSlots(
  writeBuffer: (slot: number, data: number[] | Float32Array) => void,
  slot1: number[],
  carCount: number,
): void {
  const orange: CarInst[] = [];
  const blue: CarInst[] = [];
  const n = Math.min(carCount, RCS_MAX_CARS);
  for (let i = 0; i < n; i++) {
    const row = readCar(slot1, i);
    if (!row) continue;
    if (row.extras.flags === 1) blue.push(row);
    else orange.push(row);
  }

  const ballX = slot1[RCS_BALL_BASE] ?? 0;
  const ballY = slot1[RCS_BALL_BASE + 1] ?? 1.05;
  const ballZ = slot1[RCS_BALL_BASE + 2] ?? 0;
  const ballInst = {
    matrix: hostMeshMatrixYawPos(ballX, ballY, ballZ, 0),
    extras: { animTime: 0, param1: 0, param2: 0, flags: 0 },
  };

  const batches: { assetIndex: number; instances: CarInst[] }[] = [
    { assetIndex: 0, instances: orange },
    { assetIndex: 1, instances: blue },
    { assetIndex: 2, instances: [ballInst] },
  ];

  let slot = PACK_HOST_MESH_SLOT;
  for (const batch of batches) {
    if (!batch.instances.length) continue;
    for (const part of chunk(batch.instances, perSlot)) {
      if (slot >= PACK_HOST_MESH_SLOT + RCS_HOST_MESH_SLOT_COUNT) break;
      writeBuffer(slot, encodeHostMeshSlotPacket(batch.assetIndex, part));
      slot += 1;
    }
  }
}
