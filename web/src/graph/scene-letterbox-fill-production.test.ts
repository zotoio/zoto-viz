/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getSurfaceLetterboxFill, letterboxFillStats } from "./letterbox-fill";
import { NetScene } from "./scene";

type PaintClearHost = {
  anim: { bgAudio: boolean; bgOpacity: number; bgColor: number | null };
  theme: { scene: { clear: number; fog: number; rim: number }; dark: boolean };
  fadeT: number;
  fadeFrom: { clear: number; fog: number; rim: number };
  clearHex: number;
  pulseBass: number;
  scene: { fog: { color: { setHex: (n: number) => void } } | null };
  backdrop: { setColors: (rim: number, clear: number) => void };
  syncSceneChrome: (painted: number) => void;
  mixHex: (a: number, b: number, k?: number) => number;
  sceneFill: (fadeK: number) => number;
};

function hostForPaintClear(clear: number): PaintClearHost {
  return {
    anim: { bgAudio: false, bgOpacity: 1, bgColor: null },
    theme: { scene: { clear, fog: 0x0a1020, rim: 0x112233 }, dark: true },
    fadeT: 1,
    fadeFrom: { clear, fog: 0x0a1020, rim: 0x112233 },
    clearHex: clear,
    pulseBass: 0,
    scene: { fog: { color: { setHex: vi.fn() } } },
    backdrop: { setColors: vi.fn() },
    syncSceneChrome: vi.fn(),
    mixHex: (a) => a,
    sceneFill: () => clear,
  };
}

const paintClear = (NetScene.prototype as unknown as { paintClear(this: PaintClearHost): void }).paintClear;

describe("NetScene production letterbox fill", () => {
  beforeEach(() => {
    expect.hasAssertions();
    letterboxFillStats.reset();
  });

  it("300 paintClear ticks at constant clearHex: exactly 1 fill rebuild", () => {
    const clear = 0x0a1020;
    const host = hostForPaintClear(clear);
    for (let i = 0; i < 300; i++) {
      paintClear.call(host);
    }
    expect(letterboxFillStats.rebuilds).toBe(1);
    const fillAfter = getSurfaceLetterboxFill(host.clearHex, 0.25);
    expect(getSurfaceLetterboxFill(host.clearHex, 0.25)).toBe(fillAfter);
  });
});
