/** Metro Lines — schematic transit map (sandbox entry). */

import type { VizDataFrame } from "../../../../web/src/plugins/viz-host";
import {
  acquireMetroSim,
  isMetroDemoFrame,
  metroAccent,
  metroBg,
  metroCanvasSize,
  metroHudLabel,
  METRO_MAX_TICKER_CHARS,
  METRO_SLOT_TICKER,
  packMetroParticles,
  packMetroSlots,
  parseMetroOptions,
  releaseMetroSim,
  type MetroOptions,
} from "./metro";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  onTeardown?: (() => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  writeParticles: (data: number[], stride?: number) => void;
};

let opts: MetroOptions = parseMetroOptions(zoto.getConfig?.());
const sim = acquireMetroSim();

zoto.onConfig = (cfg) => {
  opts = parseMetroOptions(cfg);
  sim.runtime.resetLayoutState();
};

zoto.onTeardown = () => {
  releaseMetroSim();
};

zoto.onFrame = (frame) => {
  const net = sim.step(frame, opts);
  const slots = packMetroSlots(frame, net, opts, sim, metroCanvasSize());
  const demo = isMetroDemoFrame(frame);
  const metric = demo ? "demo" : `${net.stations.length} st · ${net.edges.length} ln`;
  const hud = metroHudLabel(opts, metric, demo);
  const tick = slots[METRO_SLOT_TICKER];
  if (tick) {
    for (let i = 0; i < 8; i++) {
      const c = i < hud.length ? hud.charCodeAt(i) : 32;
      tick[METRO_MAX_TICKER_CHARS + i] = (c - 32) / 95;
    }
  }
  for (let i = 0; i < slots.length; i++) {
    const data = slots[i];
    if (data && data.length > 0) zoto.writeBuffer(i, data);
  }
  zoto.writeParticles(packMetroParticles(sim), 4);
  const bright = opts.nightMode ? 0.88 + frame.audio * 0.15 : 0.95 + frame.audio * 0.08;
  zoto.writeUniform("uBright", bright);
  zoto.writeUniform("uOpacity", 1);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", metroAccent(opts, frame.audio));
  zoto.writeUniform("uBg", metroBg(opts));
};
