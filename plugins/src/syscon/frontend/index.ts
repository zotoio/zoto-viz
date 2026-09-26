/** Syscon holotable — pack host SYS gauges into the plugin sky. Never writes uBright. */

import { EMPTY_SYS_GAUGES, packSysGauges, sysconCanvasSize } from "./telemetry";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";

const host = getVizZoto();

host.onFrame = (frame) => {
  const sys = frame.sys ?? EMPTY_SYS_GAUGES;
  host.writeBuffer(0, packSysGauges(sys, frame.audio, sysconCanvasSize()));
  const heat = Math.max(sys.temp, sys.failed, sys.psi);
  host.writeUniform("uAccent", [0.18 + heat * 0.55, 0.72 - heat * 0.35, 0.98 - heat * 0.25]);
  host.writeUniform("uBg", [0.01, 0.03, 0.055]);
};
