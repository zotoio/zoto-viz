/** Koi pond — talkers swim as koi toward lily pads and lotus destinations. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import {
  KoiPondSim,
  parseKoiPondOptions,
  type KoiPondOptions,
} from "./koi-pond";

type KoiPondFrame = Pick<
  VizDataFrame,
  "t" | "dt" | "audio" | "talkers" | "packets" | "sys" | "demo"
>;

declare const zoto: {
  onFrame: ((frame: KoiPondFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  writeParticles: (data: number[] | Float32Array, stride?: number) => void;
};

let options: KoiPondOptions = parseKoiPondOptions(zoto.getConfig?.());
const sim = new KoiPondSim(options);
sim.mountTile();

const buf0 = new Float32Array(64);
const buf1 = new Float32Array(64);
const buf2 = new Float32Array(64);

let lastLabel = "";

function canvasSize(): { w: number; h: number } {
  let root: Document | null = typeof document !== "undefined" ? document : null;
  try {
    if (!root && typeof parent !== "undefined" && parent.document) root = parent.document;
  } catch { /* sandbox */ }
  const canvas = (root?.querySelector?.("canvas.render-host")
    ?? root?.querySelector?.("#wall > canvas")
    ?? root?.querySelector?.("#scene canvas")) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return { w: w > 64 ? w : 1280, h: h > 64 ? h : 800 };
}

function applyLiveConfig(cfg: Record<string, string>): void {
  const parsed = parseKoiPondOptions(cfg);
  options = parsed;
  sim.setOptions(parsed);
}

zoto.onConfig = (cfg) => {
  applyLiveConfig(cfg);
};

function syncHudLabel(text: string, on: boolean): void {
  if (!on) {
    lastLabel = "";
    return;
  }
  if (text === lastLabel) return;
  lastLabel = text;
  try {
    const doc = typeof parent !== "undefined" ? parent.document : null;
    const el = doc?.getElementById?.("viz-hud");
    if (!el) return;
    const pack = el.querySelector?.(".viz-hud-pack");
    const metric = el.querySelector?.(".viz-hud-metric");
    if (pack) pack.textContent = "Koi Pond";
    if (metric) metric.textContent = text.replace(/^koi pond · /, "");
  } catch { /* cross-origin */ }
}

zoto.onFrame = (frame) => {
  const liveCfg = zoto.getConfig?.();
  if (liveCfg) applyLiveConfig(liveCfg);

  const { w, h } = canvasSize();
  const packed = sim.advance(frame, w, h);
  buf0.set(packed.slot0);
  buf1.set(packed.slot1);
  buf2.set(packed.slot2);
  zoto.writeBuffer(0, buf0);
  zoto.writeBuffer(1, buf1);
  zoto.writeBuffer(2, buf2);
  if (packed.particleCount > 0) {
    zoto.writeParticles(
      packed.particles.subarray(0, packed.particleCount * 4),
      4,
    );
  }
  zoto.writeUniform("uBright", packed.bright);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", packed.accent);
  zoto.writeUniform("uBg", packed.bg);
  syncHudLabel(packed.label, options.label);
};
