/** Syscon holotable — pack host SYS gauges into the plugin sky. Never writes uBright. */

import { EMPTY_SYS_GAUGES, packSysGauges, sysconCanvasSize, type SysGauges } from "./telemetry";

type VizFrame = {
  t: number;
  audio: number;
  sys?: SysGauges;
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

zoto.onFrame = (frame) => {
  const sys = frame.sys ?? EMPTY_SYS_GAUGES;
  zoto.writeBuffer(0, packSysGauges(sys, frame.audio, sysconCanvasSize()));
  const heat = Math.max(sys.temp, sys.failed, sys.psi);
  zoto.writeUniform("uAccent", [0.18 + heat * 0.55, 0.72 - heat * 0.35, 0.98 - heat * 0.25]);
  zoto.writeUniform("uBg", [0.01, 0.03, 0.055]);
};
