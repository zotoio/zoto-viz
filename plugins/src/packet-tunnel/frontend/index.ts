
/** Packet-field tunnel raymarch scaffold — maps decimated proto fields into sky uniforms. */

import { packetTunnelSample } from "./tunnel";
import type { VizDataFrame, VizZotoPluginHooks } from "../../../sdk/viz-contract";
void (null as VizZotoPluginHooks | null);
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();


host.onFrame = (frame) => {
  const sample = packetTunnelSample(frame);
  host.writeBuffer(0, sample.buffer);
  host.writeUniform("uBright", sample.bright);
  host.writeUniform("uAccent", sample.accent);
};
