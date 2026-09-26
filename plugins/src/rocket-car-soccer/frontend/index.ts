/** Rocket Car Soccer — sandbox driver (pack clock via viz frame time). */

import {
  clearRcsUndo,
  hexToRgb,
  parseRcsOptions,
  popRcsUndo,
  pushRcsUndo,
  randomizeRcsOptions,
  RCS_DEFAULTS,
  themeBgAccent,
  type RcsOptions,
} from "./pack";
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

let opts: RcsOptions = parseRcsOptions(zoto.getConfig?.());
let lastDice = "none";
let lastCfgSig = "";
let mounted = false;

function ensureMounted(): void {
  if (!mounted) {
    rcsMount();
    mounted = true;
  }
}

function applyConfig(cfg: Record<string, string>): void {
  const dice = cfg.dice ?? "none";
  if (dice !== lastDice) {
    if (dice === "randomise") {
      pushRcsUndo(opts);
      const rnd = randomizeRcsOptions((opts.seed ^ 0x5a5a) >>> 0, opts);
      Object.assign(cfg, {
        teamSize: String(rnd.teamSize),
        theme: rnd.theme,
        camera: rnd.camera,
        aggress: String(rnd.aggress),
        gameSpeed: String(rnd.gameSpeed),
        minCutSec: String(rnd.minCutSec),
        particles: String(rnd.particles),
        ballSize: String(rnd.ballSize),
        trail: rnd.trail,
        explode: rnd.explode,
        replay: rnd.replay ? "true" : "false",
        dice: "none",
      });
    } else if (dice === "undo") {
      const prev = popRcsUndo();
      if (prev) {
        for (const [k, v] of Object.entries(prev)) cfg[k] = String(v);
        cfg.dice = "none";
      }
    } else if (dice === "reset") {
      clearRcsUndo();
      for (const [k, v] of Object.entries(RCS_DEFAULTS)) cfg[k] = String(v);
      cfg.preset = "broadcast";
      cfg.dice = "none";
    }
    lastDice = dice;
  }
  opts = setRcsOptions(cfg);
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
  if (!cfg) return;
  const sig = JSON.stringify(cfg);
  if (sig === lastCfgSig) return;
  lastCfgSig = sig;
  applyConfig({ ...cfg });
}

zoto.onConfig = (cfg) => {
  lastCfgSig = JSON.stringify(cfg);
  applyConfig(cfg);
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
  if (out.particles.length) zoto.writeParticles(out.particles, 4);
  zoto.writeUniform("uAudio", frame.audio);
};

applyConfig(zoto.getConfig?.() ?? {});
lastCfgSig = JSON.stringify(zoto.getConfig?.() ?? {});

/** Test hook: simulate pack teardown when the view unmounts. */
export function rcsFrontendTeardown(): ReturnType<typeof rcsUnmount> {
  mounted = false;
  return rcsUnmount();
}

export function rcsFrontendMounted(): boolean {
  return mounted;
}
