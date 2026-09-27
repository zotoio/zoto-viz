/** Koi pond — talkers swim as koi toward lily pads and lotus destinations. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import {
  applyConfigActions,
  configActionEdges,
  hostTileSizeFromConfig,
  KoiPondSim,
  KOI_SLOT,
  PACK_HOST_MESH_ASSET,
  parseKoiPondOptions,
  type KoiPondOptions,
} from "./koi-pond";
import { PackModelSlotController } from "../../../sdk/pack-model-slot";
import {
  PACK_HOST_MESH_SLOT,
  hostMeshMatrixYSpin,
  shouldWriteHostMeshMatrix,
  syncPackModelHostMesh,
  writeHostMeshMatrixSlot,
} from "../../../sdk/pack-host-mesh";

declare const zoto: {
  getConfig?: () => Record<string, string>;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  onFrame: ((frame: VizDataFrame) => void) | null;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  writeParticles: (data: number[] | Float32Array, stride?: number) => void;
};

let options: KoiPondOptions = parseKoiPondOptions(zoto.getConfig?.());
let tileSize = hostTileSizeFromConfig(zoto.getConfig?.());
const sim = new KoiPondSim(options);
const modelSlot = new PackModelSlotController(zoto.getConfig?.());
sim.mountTile();

const buf0 = new Float32Array(64);
const buf1 = new Float32Array(64);
const buf2 = new Float32Array(64);

const actionLatch = { reset: false, randomise: false, undo: false };

function applyLiveConfig(cfg: Record<string, string>): void {
  const { edges, next } = configActionEdges(cfg, actionLatch);
  actionLatch.reset = next.reset;
  actionLatch.randomise = next.randomise;
  actionLatch.undo = next.undo;
  tileSize = hostTileSizeFromConfig(cfg);
  const parsed = parseKoiPondOptions(cfg);
  options = applyConfigActions(sim, cfg, parsed, edges);
  modelSlot.setConfig(cfg);
  syncPackModelHostMesh(modelSlot, cfg, PACK_HOST_MESH_ASSET);
  sim.setModelSlotFloat(modelSlot.slotFloat());
}

zoto.onConfig = (cfg) => {
  applyLiveConfig(cfg);
};

zoto.onFrame = (frame) => {
  const { w, h } = tileSize;
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
  zoto.writeUniform("uBright", packed.bright);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", packed.accent);
  zoto.writeUniform("uBg", packed.bg);
};
