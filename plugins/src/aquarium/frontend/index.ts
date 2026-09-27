/** Photoreal aquarium — host frame drives fish, packets, and SYS murk. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import {
  AquariumSim,
  applyConfigActions,
  configActionEdges,
  PACK_HOST_MESH_ASSET,
  parseAquariumOptions,
  type AquariumOptions,
} from "./aquarium";
import { PackModelSlotController } from "../../../sdk/pack-model-slot";
import {
  PACK_HOST_MESH_SLOT,
  hostMeshMatrixYSpin,
  shouldWriteHostMeshMatrix,
  syncPackModelHostMesh,
  writeHostMeshMatrixSlot,
} from "../../../sdk/pack-host-mesh";

type AquariumFrame = Pick<
  VizDataFrame,
  "t" | "dt" | "audio" | "talkers" | "packets" | "demo" | "sys"
>;

declare const zoto: {
  onFrame: ((frame: AquariumFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  writeParticles: (data: number[] | Float32Array, stride?: number) => void;
};

/** Latest host config from {@link zoto.onConfig} only (never polled in onFrame). */
let hostConfigCache: Record<string, string> = {};

let options: AquariumOptions = parseAquariumOptions();
const sim = new AquariumSim(options);
const modelSlot = new PackModelSlotController(hostConfigCache);
sim.mountTile();

const buf0 = new Float32Array(64);
const buf1 = new Float32Array(64);
const buf2 = new Float32Array(64);

const actionLatch = { reset: false, randomise: false, undo: false };

function canvasSize(): { w: number; h: number } {
  const canvas = (typeof document !== "undefined"
    ? document.querySelector("canvas.render-host")
      ?? document.querySelector("#wall > canvas")
      ?? document.querySelector("#scene canvas")
    : null) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return { w: w > 64 ? w : 1280, h: h > 64 ? h : 800 };
}

function applyLiveConfig(cfg: Record<string, string>): void {
  hostConfigCache = cfg;
  const { edges, next } = configActionEdges(cfg, actionLatch);
  actionLatch.reset = next.reset;
  actionLatch.randomise = next.randomise;
  actionLatch.undo = next.undo;
  const parsed = parseAquariumOptions(cfg);
  options = applyConfigActions(sim, cfg, parsed, edges);
  modelSlot.setConfig(cfg);
  syncPackModelHostMesh(modelSlot, cfg, PACK_HOST_MESH_ASSET);
  sim.setModelSlotFloat(modelSlot.slotFloat());
}

zoto.onConfig = (cfg) => {
  applyLiveConfig(cfg);
};

if (zoto.getConfig) {
  applyLiveConfig(zoto.getConfig());
}

zoto.onFrame = (frame) => {
  const { w, h } = canvasSize();
  const packed = sim.advance(frame, w, h);
  buf0.set(packed.slot0);
  buf1.set(packed.slot1);
  buf2.set(packed.slot2);
  zoto.writeBuffer(0, buf0);
  zoto.writeBuffer(1, buf1);
  zoto.writeBuffer(2, buf2);
  if (shouldWriteHostMeshMatrix(modelSlot.snapshot())) {
    writeHostMeshMatrixSlot(
      zoto.writeBuffer,
      PACK_HOST_MESH_SLOT,
      hostMeshMatrixYSpin(frame.t),
    );
  }
  if (packed.particleCount > 0) {
    zoto.writeParticles(
      packed.particles.subarray(0, packed.particleCount * 4),
      4,
    );
  }
  zoto.writeUniform("uBright", packed.bright);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", packed.accent);
  zoto.writeUniform("uBg", packed.bg);
};
