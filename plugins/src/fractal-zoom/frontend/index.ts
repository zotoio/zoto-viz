/** Fractal zoom — reads host config (config.read) and writes sky buffers each frame. */

import { packFractalDrive, resetFractalDrive } from "./drive";
import { IDLE_POINTER } from "./interaction";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import type { ZotoVizPluginHost } from "../../../sdk/plugin-sandbox";

type FractalHost = ZotoVizPluginHost<VizDataFrame>;

function vizHost(): FractalHost {
  return (globalThis as { zoto: FractalHost }).zoto;
}

let cfg: Record<string, string> = {};
let simT = 0;
let lastType = "";

vizHost().onConfig = (config) => {
  cfg = { ...config };
  const t = config.fractalType ?? "";
  if (t && t !== lastType) {
    lastType = t;
    simT = 0;
  }
};

vizHost().onFrame = (frame) => {
  const dt = frame.dt > 0 && frame.dt < 0.25 ? Math.min(0.1, frame.dt) : 1 / 60;
  simT += dt;
  const aspect = 16 / 10;
  const drive = packFractalDrive(simT, dt, frame.audio, aspect, cfg, IDLE_POINTER);
  const host = vizHost();
  host.writeBuffer(0, drive.slot0);
  host.writeUniform("uAccent", drive.accent);
  host.writeUniform("uBg", drive.bg);
  host.writeUniform("uOpacity", 1);
  host.writeUniform("uAudio", frame.audio);
};

resetFractalDrive();
