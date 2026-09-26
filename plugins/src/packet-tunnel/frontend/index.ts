
/** Packet-field tunnel raymarch scaffold — maps decimated proto fields into sky uniforms. */

import { packetTunnelSample } from "./tunnel";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";
const zoto = getVizZoto();


zoto.onFrame = (frame) => {
  const sample = packetTunnelSample(frame);
  zoto.writeBuffer(0, sample.buffer);
  zoto.writeUniform("uBright", sample.bright);
  zoto.writeUniform("uAccent", sample.accent);
};
