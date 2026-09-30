/** Talker storm: one storm cell per top talker, sent to the sky in UBO slots 0-1 (#180). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { stormSlots } from "./storm";
const host = getVizZoto();

// The storm travels in slots the sky reads (frontend/storm.ts), not writeParticles: the host has no
// renderer for pack particle records.
host.onFrame = (frame: VizDataFrame) => {
  const s = stormSlots(frame);
  host.writeBuffer(0, s.slot0);
  host.writeBuffer(1, s.slot1);
  host.writeUniform("uBright", 0.8 + frame.audio * 0.4);
  host.writeUniform("uAudio", frame.audio);
};
