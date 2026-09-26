
/** Cypher CIC — pack SYS + NET frames into the holodeck sky. Never writes uBright. */

import {
  cicCanvasSize, EMPTY_SYS, packPackets, packRf, packSysSlot, packTalkers,
  parseCicLook, peakRf, peakTalker, type CicLook,
} from "./pack";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();


let look: CicLook = parseCicLook(host.getConfig?.());

host.onConfig = (cfg) => {
  look = parseCicLook(cfg);
};

host.onFrame = (frame) => {
  const sys = frame.sys ?? EMPTY_SYS;
  const talkers = frame.talkers ?? [];
  const packets = frame.packets ?? [];
  const rf = frame.rf ?? [];
  const net = peakTalker(talkers);
  const air = peakRf(rf);
  host.writeBuffer(0, packSysSlot(sys, frame.audio, cicCanvasSize(), look, net, air));
  host.writeBuffer(1, packTalkers(talkers));
  host.writeBuffer(2, packPackets(packets));
  host.writeBuffer(3, packRf(rf));
  const heat = Math.max(sys.temp, sys.failed, sys.psi, net * 0.65);
  host.writeUniform("uAccent", [0.0 + heat * 0.85, 0.92 - heat * 0.55, 1.0 - heat * 0.15]);
  host.writeUniform("uBg", [0.02, 0.0, 0.07]);
};
