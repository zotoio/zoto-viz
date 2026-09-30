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
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

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
  host.writeBuffer(0, out.slot0);
  host.writeBuffer(1, out.slot1);
  host.writeUniform("uBright", out.bright);
  host.writeUniform("uAccent", out.accent);
  host.writeUniform("uBg", out.bg);
  host.writeUniform("uAudio", frame.audio);
}

host.onConfig = (cfg) => boot(cfg);

host.onFrame = (frame) => {
  if (!ready) boot(host.getConfig?.() ?? {});
  liveFrame = frame;
};

host.onPresent = (tick) => {
  if (!ready) boot(host.getConfig?.() ?? {});
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
