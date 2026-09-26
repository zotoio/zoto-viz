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

declare const window: { __zotoConfig?: Record<string, string> };

zoto.onFrame = (frame) => {
  const sample = packetTunnelSample(frame);
  const cost = Math.max(0, Math.min(64, Number(window.__zotoConfig?.shaderCost) || 0));
  zoto.writeBuffer(0, [...sample.buffer, cost]);
  zoto.writeUniform("uBright", sample.bright);
  zoto.writeUniform("uAccent", sample.accent);
};
