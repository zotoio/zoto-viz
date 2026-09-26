/** Packet-field tunnel raymarch scaffold — maps decimated proto fields into sky uniforms. */

import { packetTunnelSample } from "./tunnel";

type VizFrame = {
  t: number;
  packets: { proto: string; field: number }[];
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  const sample = packetTunnelSample(frame);
  zoto.writeBuffer(0, sample.buffer);
  zoto.writeUniform("uBright", sample.bright);
  zoto.writeUniform("uAccent", sample.accent);
};
