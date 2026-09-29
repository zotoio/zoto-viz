/** Fluid tank — steps the solver on the present clock and uploads the grid. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { advanceFluid, emptyFluidMemory, FluidSim, packFluid } from "./fluid";
import { parseFluidOptions, type FluidOptions } from "./options";

const host = getVizZoto();
const sim = new FluidSim();
const mem = emptyFluidMemory();
let opts: FluidOptions = parseFluidOptions(host.getConfig?.());
let audio = 0;
let traffic = 0;
let kick = false;
let audioPrev = 0;
let presentSeen = false;
let lastClock = -1;

const BG: Record<FluidOptions["palette"], [number, number, number]> = {
  ink: [0.93, 0.9, 0.84],
  ocean: [0.02, 0.07, 0.14],
  magma: [0.05, 0.02, 0.02],
  thermal: [0.02, 0.03, 0.08],
  neon: [0.03, 0.02, 0.06],
  mono: [0.96, 0.96, 0.95],
};

function flush(): void {
  const flat = packFluid(sim, opts);
  for (let s = 0; s < 8; s++) host.writeBuffer(s, flat.subarray(s * 64, s * 64 + 64));
  host.writeUniform("uBg", BG[opts.palette]);
  host.writeUniform("uAccent", [0.25, 0.45, 0.85]);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", audio);
}

function step(dt: number): void {
  const kickNow = kick;
  kick = false;
  advanceFluid(sim, dt, opts, { audio, traffic, kick: kickNow }, mem);
  flush();
}

host.onConfig = (cfg) => {
  opts = parseFluidOptions(cfg);
};

host.onFrame = (frame: VizDataFrame) => {
  audio = frame.audio;
  let rate = 0;
  const talkers = frame.talkers ?? [];
  for (const talker of talkers) rate += talker.rate;
  traffic = Math.min(1, rate / 80);
  kick = opts.audioMode === "kick" && frame.audio > 0.55 && frame.audio > audioPrev + 0.08;
  audioPrev = frame.audio;
  if (!presentSeen) step(frame.dt > 0 ? frame.dt : 1 / 60);
};

host.onPresent = (tick) => {
  presentSeen = true;
  const t = tick.pluginClock ?? 0;
  const dt = lastClock < 0 ? 1 / 60 : Math.min(0.25, Math.max(0, t - lastClock));
  lastClock = t;
  step(dt);
};

flush();
