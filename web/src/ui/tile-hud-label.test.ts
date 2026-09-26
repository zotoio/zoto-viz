import { afterEach, describe, expect, it } from "vitest";
import {
  createTileHudLabelLine,
  limitedLabelRevertOnSecondTick,
  resetLimitedLabelRevertCache,
  writeHudTextRevertOnSecondTick,
} from "./tile-hud-label";

const LABEL = "LIMITED · sharing frame with 3 tiles · 40 skipped/s";

function skipRateAtSecond(sec: number): number {
  if (sec < 2) return 10;
  if (sec < 5) return 20;
  if (sec < 8) return 30;
  return 40;
}

describe("tile HUD LIMITED label (60 fps, per line)", () => {
  afterEach(() => {
    resetLimitedLabelRevertCache();
    document.body.innerHTML = "";
  });

  it("D1 steady: 600 frames → exactly 1 build and 1 write per line", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 600; frame++) {
      const text = line.limitedLabel(4, 40)!;
      expect(text).toBe(LABEL);
      line.writeText(el, text);
    }
    expect(line.stats.builds).toBe(1);
    expect(line.stats.writes).toBe(1);
  });

  it("D1 schedule: new skipped/s at seconds 2, 5 and 8 → 4 builds and 4 writes per line", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 600; frame++) {
      const sec = Math.floor(frame / 60);
      const text = line.limitedLabel(4, skipRateAtSecond(sec))!;
      line.writeText(el, text);
    }
    expect(line.stats.builds).toBe(4);
    expect(line.stats.writes).toBe(4);
  });

  it("D1 revert: one-second updates → 11 builds and 11 writes per line (steady)", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 600; frame++) {
      const text = limitedLabelRevertOnSecondTick(line, 4, 40, frame)!;
      writeHudTextRevertOnSecondTick(line, el, text, frame);
    }
    expect(line.stats.builds).toBe(11);
    expect(line.stats.writes).toBe(11);
  });
});
