/**
 * Backrooms pack: director runs on the host present clock via `viz.presentTick`.
 * Sky accent colours are still written on viz.read frames so they apply after init.
 */

import type { VizPresentTick } from "../../../sdk/viz-contract";
import type { VizZoto } from "../../../sdk/viz-zoto";
import {
  backroomsSlots,
  parseBackroomsOptions,
  setBackroomsOptions,
} from "./director";

const zoto = (globalThis as { zoto: VizZoto }).zoto;

const DEFAULT_ASPECT = 16 / 9;
let wallDate = new Date(0);
let wallDateMs = 0;

function wallDateForPresent(): Date {
  const now = performance.now();
  if (now - wallDateMs > 1000) {
    wallDateMs = now;
    wallDate = new Date();
  }
  return wallDate;
}

function stageAspect(tick: VizPresentTick): number {
  const a = tick.aspect;
  if (typeof a === "number" && a > 0 && Number.isFinite(a)) return a;
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
  const drive = backroomsSlots(t, wallDateForPresent(), stageAspect(tick));
  zoto.writeBuffer(0, drive.slot0);
  zoto.writeBuffer(1, drive.slot1);
};

zoto.onFrame = () => {
  zoto.writeUniform("uAccent", [1.0, 0.92, 0.55]);
  zoto.writeUniform("uBg", [0.1, 0.09, 0.04]);
};
