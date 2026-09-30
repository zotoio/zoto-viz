/** Koi pond — talkers swim as koi toward lily pads and lotus destinations. */
import type { VizDataFrame } from "../../../sdk/viz-contract";

import {
  applyConfigActions,
  configActionEdges,
  hostTileSizeFromConfig,
  KoiPondSim,
  KOI_SLOT,
  parseKoiPondOptions,
  type KoiPondOptions,
} from "./koi-pond";
import { PackModelSlotController } from "../../../sdk/pack-model-slot";
import { shouldWriteHostMeshMatrix, syncPackModelHostMeshAssets } from "../../../sdk/pack-host-mesh";
import { writeKoiHostMeshSlots } from "./host-mesh-drive";
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

let options: KoiPondOptions = parseKoiPondOptions(host.getConfig?.());
let tileSize = hostTileSizeFromConfig(host.getConfig?.());
const sim = new KoiPondSim(options);
const modelSlot = new PackModelSlotController(host.getConfig?.());
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
  syncPackModelHostMeshAssets(modelSlot, cfg);
  sim.setModelSlotFloat(modelSlot.slotFloat());
}

host.onConfig = (cfg) => {
  applyLiveConfig(cfg);
};

host.onFrame = (frame: VizDataFrame) => {
  const { w, h } = tileSize;
  const packed = sim.advance(frame, w, h);
  buf0.set(packed.slot0);
  buf1.set(packed.slot1);
  buf2.set(packed.slot2);
  host.writeBuffer(0, buf0);
  host.writeBuffer(1, buf1);
  host.writeBuffer(2, buf2);
  if (shouldWriteHostMeshMatrix(modelSlot.snapshot())) {
    writeKoiHostMeshSlots(host.writeBuffer, buf0, buf1, frame.t);
  }
  host.writeUniform("uBright", packed.bright);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", packed.accent);
  host.writeUniform("uBg", packed.bg);
};
