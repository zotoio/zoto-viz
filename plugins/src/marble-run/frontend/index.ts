/** Marble Run — sandbox runs the sim; the host draws the Blender track and instanced glass marbles. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { workBudgetFromHostInit } from "../../../sdk/host-init-context";
import { parseMarbleOptions } from "./config";
import { CONSERVATIVE_MARBLE_WORK_BUDGET } from "./work-budget";
import { MR_MARBLE_SLOT0, MR_MARBLE_SLOTS, applyPackWorkBudget, disposeMarblePack, ingestFrame, packMarbleSlots, setMarbleOptions } from "./pack";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();

// The host may not hand the sandbox a workBudget; then the shipped visualisation.yml caps apply
// (the conservative all-zero budget would leave the run empty: 0 marbles, 0 packets per frame).
const hostBudget = host.getWorkBudget?.();
applyPackWorkBudget(hostBudget ? workBudgetFromHostInit(hostBudget) : CONSERVATIVE_MARBLE_WORK_BUDGET);
setMarbleOptions(parseMarbleOptions(host.getConfig?.()));

host.onConfig = (raw) => {
  setMarbleOptions(parseMarbleOptions(raw));
};

host.onFrame = (frame: VizDataFrame) => {
  ingestFrame(frame);
  const slots = packMarbleSlots(frame);
  host.writeBuffer(0, slots[0]!);
  for (let m = 0; m < MR_MARBLE_SLOTS; m++) host.writeBuffer(MR_MARBLE_SLOT0 + m, slots[1 + m]!);
  host.writeUniform("uBright", 0.9 + frame.audio * 0.15);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.83, 0.62, 0.3]);
  host.writeUniform("uBg", [0.06, 0.055, 0.05]);
};

export function marblePackTeardown(): void {
  disposeMarblePack();
}
