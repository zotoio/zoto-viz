import { afterEach, describe, expect, it } from "vitest";
import {
  limitedSharingLabelCached,
  limitedSharingLabelEveryTick,
  resetTileHudLabelStats,
  tileHudLabelStats,
  writeHudSkipText,
} from "./tile-hud-label";

describe("tile HUD LIMITED label cache (60 fps)", () => {
  afterEach(() => {
    resetTileHudLabelStats();
    document.body.innerHTML = "";
  });

  it("D steady 2×2: 600 frames → exactly 1 build and 1 write", () => {
    const el = document.createElement("span");
    document.body.append(el);
    const label = "LIMITED · sharing frame with 3 tiles · 40 skipped/s";
    for (let i = 0; i < 600; i++) {
      const text = limitedSharingLabelCached(4, 40);
      expect(text).toBe(label);
      writeHudSkipText(el, text!);
    }
    expect(tileHudLabelStats().builds).toBe(1);
    expect(tileHudLabelStats().writes).toBe(1);
  });

  it("D skip schedule: X changes every second → 10 builds and 10 writes (frames 0–599)", () => {
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 600; frame++) {
      const sec = Math.floor(frame / 60);
      const skips = sec;
      const text = limitedSharingLabelCached(4, skips);
      writeHudSkipText(el, text!);
    }
    // sec 0..9 inclusive at frame boundaries 0,60,...,540 → 10 distinct rates; frame 600 not included.
    expect(tileHudLabelStats().builds).toBe(10);
    expect(tileHudLabelStats().writes).toBe(10);
  });

  it("D revert: rebuild every tick → 600 builds", () => {
    resetTileHudLabelStats();
    for (let i = 0; i < 600; i++) {
      limitedSharingLabelEveryTick(4, 40);
    }
    expect(tileHudLabelStats().builds).toBe(600);
  });
});
