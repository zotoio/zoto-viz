/** Photoreal aquarium — host frame drives fish, packets, and SYS murk. */

import {
  AquariumSim,
  DEFAULT_OPTIONS,
  parseAquariumOptions,
  type AquariumOptions,
  type VizAquariumFrame,
} from "./aquarium";

declare const zoto: {
  onFrame: ((frame: VizAquariumFrame) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
  writeParticles: (data: number[] | Float32Array, stride?: number) => void;
};

let options: AquariumOptions = parseAquariumOptions(zoto.getConfig?.());
const sim = new AquariumSim(options);

const buf0 = new Float32Array(64);
const buf1 = new Float32Array(64);
const buf2 = new Float32Array(64);

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

zoto.onConfig = (cfg) => {
  options = parseAquariumOptions(cfg);
  sim.setOptions(options);
};

zoto.onFrame = (frame) => {
  const { w, h } = canvasSize();
  const packed = sim.advance(frame);
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
};
