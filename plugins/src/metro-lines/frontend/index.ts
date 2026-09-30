/** Metro Lines — schematic transit map (sandbox entry). */
import type { VizDataFrame } from "../../../sdk/viz-contract";

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
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

let opts: MetroOptions = parseMetroOptions(host.getConfig?.());
let tile = metroCanvasSize(host.getConfig?.());
const sim = acquireMetroSim();

host.onConfig = (cfg) => {
  opts = parseMetroOptions(cfg);
  tile = metroCanvasSize(cfg);
  sim.runtime.resetLayoutState();
};

host.onFrame = (frame: VizDataFrame) => {
  const net = sim.step(frame, opts);
  const slots = packMetroSlots(frame, net, opts, sim, tile);
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
    if (data && data.length > 0) host.writeBuffer(i, data);
  }
  host.writeParticles(packMetroParticles(sim), 4);
  const bright = opts.nightMode ? 0.88 + frame.audio * 0.15 : 0.95 + frame.audio * 0.08;
  host.writeUniform("uBright", bright);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", metroAccent(opts, frame.audio));
  host.writeUniform("uBg", metroBg(opts));
};

/** Release the shared sim (was the onTeardown hook, which the host never calls). */
export function metroLinesTeardown(): void {
  releaseMetroSim();
}
