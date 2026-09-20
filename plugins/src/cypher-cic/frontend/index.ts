/** Cypher CIC — pack SYS + NET frames into the holodeck sky. Never writes uBright. */

import {
  cicCanvasSize, EMPTY_SYS, packPackets, packRf, packSysSlot, packTalkers,
  parseCicLook, peakRf, peakTalker, type CicLook, type SysGauges,
} from "./pack";

type VizFrame = {
  t: number;
  audio: number;
  sys?: SysGauges;
  talkers?: { id: string; rate: number; role: string }[];
  packets?: { proto?: string; size?: number; field?: number }[];
  rf?: { ssid?: string; rssi?: number; channel?: number }[];
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

let look: CicLook = parseCicLook(zoto.getConfig?.());

zoto.onConfig = (cfg) => {
  look = parseCicLook(cfg);
};

zoto.onFrame = (frame) => {
  const sys = frame.sys ?? EMPTY_SYS;
  const talkers = frame.talkers ?? [];
  const packets = frame.packets ?? [];
  const rf = frame.rf ?? [];
  const net = peakTalker(talkers);
  const air = peakRf(rf);
  zoto.writeBuffer(0, packSysSlot(sys, frame.audio, cicCanvasSize(), look, net, air));
  zoto.writeBuffer(1, packTalkers(talkers));
  zoto.writeBuffer(2, packPackets(packets));
  zoto.writeBuffer(3, packRf(rf));
  const heat = Math.max(sys.temp, sys.failed, sys.psi, net * 0.65);
  zoto.writeUniform("uAccent", [0.0 + heat * 0.85, 0.92 - heat * 0.55, 1.0 - heat * 0.15]);
  zoto.writeUniform("uBg", [0.02, 0.0, 0.07]);
};
