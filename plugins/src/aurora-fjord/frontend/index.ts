/** Aurora Fjord — the sandbox runs Kp, cabins, ripples and fog; the host draws the Blender fjord. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { workBudgetFromHostInit } from "../../../sdk/host-init-context";
import { parseFjordOptions } from "./config";
import { SHIPPED_FJORD_WORK_BUDGET, fjordWorkBudget } from "./work-budget";
import {
  AF_CABIN_SLOT,
  AF_RIPPLE_SLOT,
  applyPackWorkBudget,
  disposeFjordPack,
  ingestFrame,
  packFjordSlots,
  setFjordOptions,
} from "./fjord";
import { getVizZoto } from "plugins/sdk/viz-zoto";
const host = getVizZoto();

// Without a host workBudget the shipped visualisation.yml caps apply (the conservative all-zero
// budget would leave the water with no ripples).
const hostBudget = (host as { getWorkBudget?: () => unknown }).getWorkBudget?.();
applyPackWorkBudget(hostBudget ? workBudgetFromHostInit(hostBudget) : SHIPPED_FJORD_WORK_BUDGET);
setFjordOptions(parseFjordOptions(host.getConfig?.(), fjordWorkBudget().maxInstances));

host.onConfig = (raw) => {
  setFjordOptions(parseFjordOptions(raw, fjordWorkBudget().maxInstances));
};

host.onFrame = (frame: VizDataFrame) => {
  ingestFrame(frame);
  const slots = packFjordSlots(frame);
  host.writeBuffer(0, slots[0]!);
  host.writeBuffer(AF_CABIN_SLOT, slots[AF_CABIN_SLOT]!);
  host.writeBuffer(AF_RIPPLE_SLOT, slots[AF_RIPPLE_SLOT]!);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", [0.36, 1.0, 0.62]);
  host.writeUniform("uBg", [0.02, 0.028, 0.045]);
};

export function fjordPackTeardown(): void {
  disposeFjordPack();
}
