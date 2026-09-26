/** Packet-field tunnel raymarch scaffold — maps decimated proto fields into sky uniforms. */

import { packetTunnelSample } from "./tunnel";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "packets">) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  const sample = packetTunnelSample(frame);
  zoto.writeBuffer(0, sample.buffer);
  zoto.writeUniform("uBright", sample.bright);
  zoto.writeUniform("uAccent", sample.accent);
};
