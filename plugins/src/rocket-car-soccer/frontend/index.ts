/** Rocket Car Soccer — sandbox driver (pack clock via viz frame time). */

import { hexToRgb, parseRcsOptions, themeBgAccent, type RcsOptions } from "./pack";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { rcsMount, rcsTick, rcsUnmount, setRcsOptions } from "./match";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  writeParticles: (data: number[], stride?: number) => void;
};

let opts: RcsOptions = parseRcsOptions({});
let mergedCfg: Record<string, string> = {};
let lastHostSnapshot: Record<string, string> = {};
let lastCfgRef: Record<string, string> | undefined;
let mounted = false;

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
  const theme = themeBgAccent(opts.theme);
  const orange = hexToRgb(opts.teamOrange);
  const blue = hexToRgb(opts.teamBlue);
  zoto.writeUniform("uBg", theme.bg);
  zoto.writeUniform("uAccent", [
    orange[0] * 0.55 + blue[0] * 0.45,
    orange[1] * 0.55 + blue[1] * 0.45,
    orange[2] * 0.55 + blue[2] * 0.45,
  ]);
  zoto.writeUniform("uBright", 1.05);
  zoto.writeUniform("uOpacity", 1);
}

function pollHostConfig(): void {
  const cfg = zoto.getConfig?.();
  if (!cfg || cfg === lastCfgRef) return;
  lastCfgRef = cfg;
  applyConfig(cfg);
}

zoto.onConfig = (cfg) => {
  lastCfgRef = cfg;
  applyConfig({ ...cfg });
};

zoto.onFrame = (frame) => {
  ensureMounted();
  pollHostConfig();
  const feedDt = frame.dt > 0 && frame.dt < 0.2 ? frame.dt : frame.dt >= 0.25 ? frame.dt : 1 / 60;
  const aspect = 16 / 9;
  const out = rcsTick(frame, frame.t, feedDt, aspect);
  zoto.writeBuffer(0, out.slot0);
  zoto.writeBuffer(1, out.slot1);
  zoto.writeBuffer(2, out.slot2);
  if (out.budget.particles > 0) {
    zoto.writeParticles(out.particles, 4);
  }
  zoto.writeUniform("uAudio", frame.audio);
};

const bootCfg = zoto.getConfig?.();
if (bootCfg) {
  lastCfgRef = bootCfg;
  applyConfig(bootCfg);
} else {
  applyConfig({});
}

/** Test hook: simulate pack teardown when the view unmounts. */
export function rcsFrontendTeardown(): ReturnType<typeof rcsUnmount> {
  mounted = false;
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
}

export function rcsTestApplyHostConfigForTest(cfg: Record<string, string>): void {
  applyConfig({ ...cfg });
}
