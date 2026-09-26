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

<<<<<<< HEAD
const zoto = globalThis.zoto as VizZoto;
=======
declare const zoto: {
  onConfig: ((config: Record<string, string>) => void) | null;
  onPresent: ((tick: VizPresentTick) => void) | null;
  onFrame: (() => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[] | ArrayLike<number>) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};
>>>>>>> origin/cursor/backrooms-chase-nav-713c

const DEFAULT_ASPECT = 16 / 9;

function stageAspect(): number {
  if (typeof innerWidth === "number" && innerWidth > 0) {
    return innerWidth / Math.max(1, innerHeight);
  }
  return DEFAULT_ASPECT;
}

setBackroomsOptions(parseBackroomsOptions(zoto.getConfig?.()));

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
