/** Rocket Car Soccer sky colours. Host `match.ts` fills buffers on the sky clock. */

import { hexToRgb, parseRcsOptions, themeBgAccent, type RcsOptions } from "./pack";

declare const zoto: {
  onFrame: (() => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

let opts: RcsOptions = parseRcsOptions(zoto.getConfig?.());

function applyLook(cfg: Record<string, string>): void {
  opts = parseRcsOptions(cfg);
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

zoto.onConfig = (cfg) => applyLook(cfg);
zoto.onFrame = () => {
  /* Buffers come from the host afterLook hook — avoid double-stepping the sim. */
};

applyLook(zoto.getConfig?.() ?? {});
