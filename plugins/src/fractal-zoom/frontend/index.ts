/** Fractal zoom — reads host config (config.read) and writes sky buffers each frame. */

import { packFractalDrive, resetFractalDrive } from "./drive";
import { IDLE_POINTER } from "./interaction";
import "../../../sdk/plugin-sandbox";

let cfg: Record<string, string> = {};
let lastT = 0;
let lastType = "";

zoto.onConfig = (config) => {
  cfg = { ...config };
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
  const drive = packFractalDrive(frame.t, dt, frame.audio, aspect, cfg, IDLE_POINTER);
  zoto.writeBuffer(0, drive.slot0);
  zoto.writeUniform("uBright", drive.bright);
  zoto.writeUniform("uAccent", drive.accent);
  zoto.writeUniform("uBg", drive.bg);
  zoto.writeUniform("uOpacity", 1);
  zoto.writeUniform("uAudio", frame.audio);
};

resetFractalDrive();
