/** Fractal zoom — reads host config (config.read) and writes sky buffers each frame. */

import { FractalDriveRuntime, resetFractalDrive } from "./drive";
import { IDLE_POINTER } from "./interaction";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: VizDataFrame) => void) | null;
  onConfig: ((config: Record<string, string>) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

const driveRuntime = new FractalDriveRuntime();
let lastT = 0;
let lastType = "";
let cfg: Record<string, string> = {};

zoto.onConfig = (config) => {
  cfg = config;
  const t = config.fractalType ?? "";
  if (t && t !== lastType) {
    lastType = t;
    lastT = 0;
  }
};

zoto.onFrame = (frame) => {
  const dt = lastT > 0 ? Math.min(0.1, Math.max(1 / 240, frame.t - lastT)) : frame.dt || 1 / 60;
  lastT = frame.t;
  const aspect = 16 / 10;
  const drive = driveRuntime.packDrive(frame.t, dt, frame.audio, aspect, cfg, IDLE_POINTER);
  zoto.writeBuffer(0, drive.slot0);
  zoto.writeUniform("uBright", drive.bright);
  zoto.writeUniform("uAccent", drive.accent);
  zoto.writeUniform("uBg", drive.bg);
  zoto.writeUniform("uOpacity", 1);
  zoto.writeUniform("uAudio", frame.audio);
};

resetFractalDrive();
