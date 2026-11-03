import {
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
  maxHostMeshInstancesPerSlot,
} from "../../../sdk/host-mesh-frame";
import { PACK_HOST_MESH_SLOT } from "../../../sdk/pack-host-mesh";
import { AQU_SLOT } from "./aquarium";
import { FISH_MESH_SCALE } from "./fish-behaviour";

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

/** Designer fish are about 4–15 cm; this sits them in the tank without filling it. */
const FISH_SCALE = FISH_MESH_SCALE;

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

/**
 * Per-fish yaw rate (rad/s) for the host, carried in extras.param1. The host bends the HD fish
 * spine by it; Standard ignores it. Fish are tracked by school index; a jump bigger than a fish
 * can turn in one frame (slot reshuffle) resets that fish instead of reading as a spin.
 */
export class FishTurnTracker {
  private prev = new Map<number, { yaw: number; rate: number }>();
  private lastClock = Number.NaN;
  private dt = 0;

  /** Start a frame at host clock `clock` (seconds). */
  frame(clock: number): void {
    const dt = clock - this.lastClock;
    this.dt = Number.isFinite(dt) && dt > 0 && dt < 0.5 ? dt : 0;
    this.lastClock = clock;
  }

  /** Smoothed yaw rate for fish `n` now at `yaw`. */
  rate(n: number, yaw: number): number {
    const p = this.prev.get(n);
    let rate = 0;
    if (p && this.dt > 0) {
      const d = Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw));
      const raw = Math.abs(d) > 0.6 ? 0 : d / this.dt;
      const k = Math.min(1, this.dt * 6);
      rate = p.rate + (Math.max(-4, Math.min(4, raw)) - p.rate) * k;
    }
    this.prev.set(n, { yaw, rate });
    return rate;
  }
}

const defaultTurnTracker = new FishTurnTracker();

export function writeAquariumHostMeshSlots(
  writeBuffer: (slot: number, data: number[] | Float32Array) => void,
  slot0: ArrayLike<number>,
  slot1: ArrayLike<number>,
  clock: number,
  turns: FishTurnTracker = defaultTurnTracker,
  motion?: { turn: ArrayLike<number>; phase: ArrayLike<number>; grow?: ArrayLike<number> },
): void {
  const byAsset = new Map<number, { matrix: number[]; extras: { animTime: number; param1: number; param2: number; flags: number } }[]>();
  const push = (assetIndex: number, matrix: number[], animTime: number, turnRate = 0) => {
    const list = byAsset.get(assetIndex) ?? [];
    list.push({ matrix, extras: { animTime, param1: turnRate, param2: 0, flags: 0 } });
    byAsset.set(assetIndex, list);
  };

  const fishCount = Math.round(Number(slot0[AQU_SLOT.fishCount]) || 0);
  const reef = Number(slot0[AQU_SLOT.water]) > 0.5;
  turns.frame(clock);
  for (let fi = 0, n = 0; n < fishCount && fi + 3 < slot1.length; fi += 4, n++) {
    const x = Number(slot1[fi]) || 0;
    const y = Number(slot1[fi + 1]) || 0;
    const z = Number(slot1[fi + 2]) || 0;
    const yaw = Number(slot1[fi + 3]) || 0;
    const species = Math.round(Number(slot0[AQU_SLOT.fishSpecies0 + n]) || 0);
    const vigor = Number(slot0[AQU_SLOT.fishVigor0 + n]) || 0.5;
    const assetIndex = assetForSpecies(species, reef);
    const fishY = species === CORY_SPECIES_INDEX ? y + CORY_BELLY_LIFT_M * FISH_SCALE : y;
    const tracked = turns.rate(n, yaw);
    // The sim's own yaw rate and speed-driven fin phase when the pack hands them over; otherwise
    // fall back to the clock and the yaw-difference tracker.
    const simTurn = motion ? Number(motion.turn[n]) : Number.NaN;
    const simPhase = motion ? Number(motion.phase[n]) : Number.NaN;
    const phase = Number.isFinite(simPhase) ? simPhase : clock * (0.9 + vigor * 0.4) + n * 0.29;
    const turnRate = Number.isFinite(simTurn) ? Math.max(-4, Math.min(4, simTurn)) : tracked;
    // A hatched fry grows to full size (the sim keeps its smaller body inside the glass too).
    const growRaw = motion?.grow ? Number(motion.grow[n]) : 1;
    const grow = Number.isFinite(growRaw) ? Math.max(0.05, Math.min(1, growRaw)) : 1;
    push(assetIndex, hostMeshMatrixYawPos(x, fishY, z, yaw, FISH_SCALE * grow), phase, turnRate);
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
