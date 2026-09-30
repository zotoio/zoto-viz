/** Talker storm: one storm cell per top talker, sent to the sky in UBO slot 1 (#180). */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { stormBright, stormSlots } from "./storm";
const host = getVizZoto();

// The storm travels in slot 1, which the sky reads (frontend/storm.ts), not writeParticles: the host
// has no renderer for pack particle records. Slot 0 belongs to the host pack mirror, which writes
// [count, audio, t mod 1] every frame, so the pack never writes it.
host.onFrame = (frame: VizDataFrame) => {
  host.writeBuffer(1, stormSlots(frame).slot1);
  host.writeUniform("uBright", stormBright(frame.audio));
  host.writeUniform("uAudio", frame.audio);
};
