/** IN-18 Nixie clock — local time packed into sky slots. */

import {
  formatNixieFallbackLine,
  nixieCanvasSize,
  packNixieBuffer,
  parseNixieLook,
  type NixieLook,
} from "./tubes";
import type { VizDataFrame } from "../../../sdk/viz-contract";

declare const zoto: {
  onFrame: ((frame: Pick<VizDataFrame, "t" | "audio" | "talkers">) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  setFallbackText: (text: string) => void;
};

let look: NixieLook = parseNixieLook(zoto.getConfig?.());
const NIXIE_NOW = new Date();
const NIXIE_SCRATCH = { h: 0, m: 0, s: 0 };
const NIXIE_CACHE = { key: -1, text: "" };
let lastPushed = "";

function nixieFallbackLine(): string {
  NIXIE_NOW.setTime(Date.now());
  return formatNixieFallbackLine(NIXIE_NOW, look, NIXIE_SCRATCH, NIXIE_CACHE);
}

function pushFallbackIfChanged(): void {
  const line = nixieFallbackLine();
  if (line === lastPushed) return;
  lastPushed = line;
  zoto.setFallbackText(line);
}

zoto.onConfig = (cfg) => {
  look = parseNixieLook(cfg);
  pushFallbackIfChanged();
};

zoto.onFrame = (frame) => {
  pushFallbackIfChanged();
  const peak = Math.min(1, (frame.talkers?.[0]?.rate ?? 0) / 180);
  zoto.writeBuffer(0, packNixieBuffer(new Date(), look, frame.audio, peak, nixieCanvasSize()));
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [1.0, 0.38, 0.06]);
  zoto.writeUniform("uBg", [0.06, 0.03, 0.02]);
};
