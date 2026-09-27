/** Voxel World — config.read only; drives sky slots + GPU mesh stats from viz frames.
 * Sim clock is accumulated dt in engine.ts (host present tick when enabled).
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
import type { VizDataFrame, VizPresentTick } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onPresent: ((tick: VizPresentTick) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  setPluginConfig?: (cfg: Record<string, string>) => void;
};

let ready = false;
let liveFrame: VizDataFrame | null = null;
let liveAspect = 1.6;

function boot(cfg: Record<string, string>): void {
  setVoxConfig(cfg);
  if (!ready) {
    initVoxelWorld();
    ready = true;
  }
}

function pushVizOut(frame: VizDataFrame, dt: number): void {
  const out = tickVoxelWorld(
    {
      t: frame.t,
      demo: frame.demo,
      packets: frame.packets,
      talkers: frame.talkers,
      headlines: frame.headlines,
      sys: frame.sys,
    },
    liveAspect,
    dt,
  );
  zoto.writeBuffer(0, out.slot0);
  zoto.writeBuffer(1, out.slot1);
  zoto.writeUniform("uBright", out.bright);
  zoto.writeUniform("uAccent", out.accent);
  zoto.writeUniform("uBg", out.bg);
  zoto.writeUniform("uAudio", frame.audio);
}

zoto.onConfig = (cfg) => boot(cfg);

zoto.onFrame = (frame) => {
  if (!ready) boot(zoto.getConfig?.() ?? {});
  liveFrame = frame;
};

zoto.onPresent = (tick) => {
  if (!ready) boot(zoto.getConfig?.() ?? {});
  if (!liveFrame) return;
  if (typeof tick.aspect === "number" && tick.aspect > 0) liveAspect = tick.aspect;
  const dt = tick.frameMs > 0 ? tick.frameMs / 1000 : 1 / 60;
  pushVizOut(liveFrame, dt);
};

export {
  disposeVoxelWorld,
  randomiseVoxConfig,
  resetVoxConfig,
  undoVoxConfig,
};
