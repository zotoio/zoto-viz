/** Voxel World — config.read only; drives sky slots + GPU mesh stats from viz frames.
 * Sim clock is accumulated dt in engine.ts (host frame.t is wall time).
 */

import {
  disposeVoxelWorld,
  initVoxelWorld,
  randomiseVoxConfig,
  resetVoxConfig,
  setVoxConfig,
  tickVoxelWorld,
  undoVoxConfig,
} from "./engine";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  /** Optional host hook — persist pack-side randomise / undo / reset. */
  setPluginConfig?: (cfg: Record<string, string>) => void;
};

let ready = false;

function boot(cfg: Record<string, string>): void {
  setVoxConfig(cfg);
  if (!ready) {
    initVoxelWorld();
    ready = true;
  }
}

zoto.onConfig = (cfg) => boot(cfg);

zoto.onFrame = (frame) => {
  if (!ready) boot(zoto.getConfig?.() ?? {});
  const out = tickVoxelWorld(
    {
      t: frame.t,
      demo: frame.demo,
      packets: frame.packets,
      talkers: frame.talkers,
      headlines: frame.headlines,
      sys: frame.sys,
    },
    1.6,
    frame.dt > 0 ? frame.dt : 1 / 60,
  );
  zoto.writeBuffer(0, out.slot0);
  zoto.writeBuffer(1, out.slot1);
  zoto.writeUniform("uBright", out.bright);
  zoto.writeUniform("uAccent", out.accent);
  zoto.writeUniform("uBg", out.bg);
  zoto.writeUniform("uAudio", frame.audio);
};

export {
  disposeVoxelWorld,
  randomiseVoxConfig,
  resetVoxConfig,
  undoVoxConfig,
};
