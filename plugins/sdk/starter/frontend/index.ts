/** Pack starter entry — copy to plugins/src/<id>/frontend/index.ts */

import { getVizZoto } from "../../../sdk/viz-zoto";
import { VIZ_PACK_TILE_FALLBACK } from "../../../sdk/viz-pack-host";
import { DEFAULT_OPTIONS, parseStarterOptions, type StarterOptions } from "./config";
import { StarterSim } from "./sim";
import { asStarterFrame } from "./starter-frame";

const host = getVizZoto();

let options: StarterOptions = DEFAULT_OPTIONS;
const sim = new StarterSim(options);

function applyConfig(cfg: Record<string, string> | undefined): void {
  options = parseStarterOptions(cfg);
  sim.setOptions(options);
}

host.onConfig = (cfg) => {
  applyConfig(cfg);
};

applyConfig(host.getConfig?.());

host.onFrame = (frame) => {
  const tile = VIZ_PACK_TILE_FALLBACK;
  const packed = sim.advance(asStarterFrame(frame), tile.w, tile.h);
  host.writeBuffer(0, packed.slot0);
  host.writeUniform("uBright", packed.bright);
  host.writeUniform("uAccent", packed.accent);
  host.writeUniform("uBg", packed.bg);
  host.writeUniform("uOpacity", 0.92);
  host.writeUniform("uTime", frame.t);
};
