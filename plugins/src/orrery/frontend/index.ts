/** Orrery — the sandbox runs the clockwork; the host draws the Blender desk, machine and planets. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { workBudgetFromHostInit } from "../../../sdk/host-init-context";
import { parseOrreryOptions } from "./config";
import { SHIPPED_ORRERY_WORK_BUDGET, orreryWorkBudget } from "./work-budget";
import {
  OR_ARM_SLOT,
  OR_SPARK_SLOT0,
  OR_SPARK_SLOTS,
  applyPackWorkBudget,
  disposeOrreryPack,
  ingestFrame,
  packOrrerySlots,
  setOrreryOptions,
} from "./orrery";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();

// Without a host workBudget the shipped visualisation.yml caps apply (the conservative all-zero
// budget would leave the orrery with no sparks and no planets).
const hostBudget = (host as { getWorkBudget?: () => unknown }).getWorkBudget?.();
applyPackWorkBudget(hostBudget ? workBudgetFromHostInit(hostBudget) : SHIPPED_ORRERY_WORK_BUDGET);
setOrreryOptions(parseOrreryOptions(host.getConfig?.(), orreryWorkBudget().maxInstances));

host.onConfig = (raw) => {
  setOrreryOptions(parseOrreryOptions(raw, orreryWorkBudget().maxInstances));
};

host.onFrame = (frame: VizDataFrame) => {
  ingestFrame(frame);
  const slots = packOrrerySlots(frame);
  host.writeBuffer(0, slots[0]!);
  host.writeBuffer(OR_ARM_SLOT, slots[OR_ARM_SLOT]!);
  for (let m = 0; m < OR_SPARK_SLOTS; m++) host.writeBuffer(OR_SPARK_SLOT0 + m, slots[OR_SPARK_SLOT0 + m]!);
  host.writeUniform("uBright", 0.92 + frame.audio * 0.1);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.86, 0.66, 0.36]);
  host.writeUniform("uBg", [0.07, 0.05, 0.035]);
};

export function orreryPackTeardown(): void {
  disposeOrreryPack();
}
