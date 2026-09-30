/** Rocket Car Soccer — sandbox driver (pack clock via viz frame time). */

import { hexToRgb, parseRcsOptions, themeBgAccent, RCS_SLOT, type RcsOptions } from "./pack";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { rcsMount, rcsTick, rcsUnmount, setRcsOptions } from "./match";
import { PackModelSlotController } from "../../../sdk/pack-model-slot";
import { shouldWriteHostMeshMatrix, syncPackModelHostMeshAssets } from "../../../sdk/pack-host-mesh";
import { writeRcsHostMeshSlots } from "./host-mesh-drive";
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

let opts: RcsOptions = parseRcsOptions({});
let mergedCfg: Record<string, string> = {};
let lastHostSnapshot: Record<string, string> = {};
let lastCfgRef: Record<string, string> | undefined;
let mounted = false;
/** Host `frame.t` is wall/unix; orbit/ball cameras cannot use it as sim seconds. */
let simClock = 0;
let simStarted = false;
const modelSlot = new PackModelSlotController(host.getConfig?.());
let lookBg: [number, number, number] = [0, 0, 0];
let lookAccent: [number, number, number] = [1, 1, 1];

function mergeHostDelta(cfg: Record<string, string>): void {
  for (const key of Object.keys(cfg)) {
    const v = cfg[key] ?? "";
    if (lastHostSnapshot[key] !== v) {
      mergedCfg[key] = v;
    }
  }
  lastHostSnapshot = { ...cfg };
}

function ensureMounted(): void {
  if (!mounted) {
    rcsMount();
    mounted = true;
  }
}

function applyConfig(cfg: Record<string, string>): void {
  mergeHostDelta(cfg);
  opts = setRcsOptions(mergedCfg);
  modelSlot.setConfig(mergedCfg);
  syncPackModelHostMeshAssets(modelSlot, mergedCfg);
  const theme = themeBgAccent(opts.theme);
  const orange = hexToRgb(opts.teamOrange);
  const blue = hexToRgb(opts.teamBlue);
  lookBg = theme.bg;
  lookAccent = [
    orange[0] * 0.55 + blue[0] * 0.45,
    orange[1] * 0.55 + blue[1] * 0.45,
    orange[2] * 0.55 + blue[2] * 0.45,
  ];
  writeLookUniforms();
}

/**
 * Look uniforms from the last applied config. Written on every present and every data
 * frame, not only on config events, so the stage keeps the pack's look (#180).
 */
function writeLookUniforms(): void {
  host.writeUniform("uBg", lookBg);
  host.writeUniform("uAccent", lookAccent);
  host.writeUniform("uBright", 1.05);
  host.writeUniform("uOpacity", 1);
}

function pollHostConfig(): void {
  const cfg = host.getConfig?.();
  if (!cfg || cfg === lastCfgRef) return;
  lastCfgRef = cfg;
  applyConfig(cfg);
}

host.onConfig = (cfg) => {
  lastCfgRef = cfg;
  applyConfig({ ...cfg });
};

host.onFrame = (frame: VizDataFrame) => {
  ensureMounted();
  pollHostConfig();
  const feedDt = frame.dt > 0 && frame.dt < 0.2 ? frame.dt : frame.dt >= 0.25 ? frame.dt : 1 / 60;
  const aspect = 16 / 9;
  if (!simStarted) {
    simClock = 0;
    simStarted = true;
  } else {
    simClock += feedDt;
  }
  const out = rcsTick(frame, simClock, feedDt, aspect);
  out.slot0[RCS_SLOT.modelFlags] = modelSlot.slotFloat();
  host.writeBuffer(0, out.slot0);
  host.writeBuffer(1, out.slot1);
  host.writeBuffer(2, out.slot2);
  if (shouldWriteHostMeshMatrix(modelSlot.snapshot())) {
    writeRcsHostMeshSlots(host.writeBuffer, out.slot1, Math.round(out.slot0[RCS_SLOT.carCount]!));
  }
  if (out.budget.particles > 0) {
    host.writeParticles(out.particles, 4);
  }
  host.writeUniform("uAudio", frame.audio);
  writeLookUniforms();
};

host.onPresent = () => {
  writeLookUniforms();
};

const bootCfg = host.getConfig?.();
if (bootCfg) {
  lastCfgRef = bootCfg;
  applyConfig(bootCfg);
} else {
  applyConfig({});
}

/** Test hook: simulate pack teardown when the view unmounts. */
export function rcsFrontendTeardown(): ReturnType<typeof rcsUnmount> {
  mounted = false;
  simClock = 0;
  simStarted = false;
  modelSlot.dispose();
  return rcsUnmount();
}

export function rcsFrontendMounted(): boolean {
  return mounted;
}

export function rcsFrontendOptionsForTest(): RcsOptions {
  return opts;
}

export function rcsTestResetDriverStateForTest(): void {
  mergedCfg = {};
  lastHostSnapshot = {};
  lastCfgRef = undefined;
  simClock = 0;
  simStarted = false;
}

export function rcsTestApplyHostConfigForTest(cfg: Record<string, string>): void {
  applyConfig({ ...cfg });
}
