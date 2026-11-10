/** Bonsai Seasons — the sandbox runs the seasons; the host draws the Blender bench, slab and tree. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { workBudgetFromHostInit } from "../../../sdk/host-init-context";
import { parseBonsaiOptions } from "./config";
import { SHIPPED_BONSAI_WORK_BUDGET, bonsaiWorkBudget } from "./work-budget";
import {
  BS_SLOT_COUNT,
  BS_SLOT,
  applyPackWorkBudget,
  disposeBonsaiPack,
  ingestFrame,
  packBonsaiSlots,
  setBonsaiOptions,
} from "./bonsai";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();

// Without a host workBudget the shipped visualisation.yml caps apply (the conservative all-zero
// budget would leave the tree with no blossoms and no falling leaves).
const hostBudget = (host as { getWorkBudget?: () => unknown }).getWorkBudget?.();
applyPackWorkBudget(hostBudget ? workBudgetFromHostInit(hostBudget) : SHIPPED_BONSAI_WORK_BUDGET);
setBonsaiOptions(parseBonsaiOptions(host.getConfig?.(), bonsaiWorkBudget().maxInstances));

host.onConfig = (raw) => {
  setBonsaiOptions(parseBonsaiOptions(raw, bonsaiWorkBudget().maxInstances));
};

host.onFrame = (frame: VizDataFrame) => {
  ingestFrame(frame);
  const slots = packBonsaiSlots(frame);
  for (let s = 0; s < BS_SLOT_COUNT; s++) host.writeBuffer(s, slots[s]!);
  const hd = slots[0]!;
  host.writeUniform("uBright", 0.9 + hd[BS_SLOT.light]! * 0.1);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.62, 0.74, 0.44]);
  host.writeUniform("uBg", [0.05, 0.07, 0.05]);
};

export function bonsaiPackTeardown(): void {
  disposeBonsaiPack();
}
