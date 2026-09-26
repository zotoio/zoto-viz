/**
 * Backrooms pack: director runs on the host present clock via `viz.presentTick`.
 * Sky accent colours are still written on viz.read frames so they apply after init.
 */

import type { VizZoto } from "../../../sdk/viz-zoto";
import {
  backroomsSlots,
  parseBackroomsOptions,
  setBackroomsOptions,
} from "./director";

const zoto = globalThis.zoto as VizZoto;

const DEFAULT_ASPECT = 16 / 9;

function stageAspect(): number {
  if (typeof innerWidth === "number" && innerWidth > 0) {
    return innerWidth / Math.max(1, innerHeight);
  }
  return DEFAULT_ASPECT;
}

zoto.onConfig = (config) => {
  setBackroomsOptions(parseBackroomsOptions(config));
};

zoto.onPresent = (tick) => {
  const t = typeof tick.pluginClock === "number" && Number.isFinite(tick.pluginClock)
    ? tick.pluginClock
    : 0;
  const drive = backroomsSlots(t, new Date(), stageAspect());
  zoto.writeBuffer(0, Array.from(drive.slot0));
  zoto.writeBuffer(1, Array.from(drive.slot1));
};

zoto.onFrame = () => {
  zoto.writeUniform("uAccent", [1.0, 0.92, 0.55]);
  zoto.writeUniform("uBg", [0.1, 0.09, 0.04]);
};
