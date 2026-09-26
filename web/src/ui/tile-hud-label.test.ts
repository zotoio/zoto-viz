import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tileLimitedSharingLabel } from "./viz-copy";
import { createTileHudLabelLine } from "./tile-hud-label";

const LABEL_4_K3 = tileLimitedSharingLabel(4, 3);

describe("tile HUD LIMITED label (60 fps, per line)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("D1 steady: 600 frames at fixed N and k → exactly 1 build and 1 write per line", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 600; frame++) {
      const text = line.limitedLabel(4, 3)!;
      expect(text).toBe(LABEL_4_K3);
      line.writeText(el, text);
    }
    expect(line.stats.builds).toBe(1);
    expect(line.stats.writes).toBe(1);
  });

  it("D1 cadence: ring skip rate changes do not rebuild label when N and k are fixed", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    const fakeRingRates = [10, 20, 30, 40, 55, 40, 40];
    for (let frame = 0; frame < 600; frame++) {
      const rate = fakeRingRates[Math.floor(frame / 60) % fakeRingRates.length]!;
      void rate;
      const text = line.limitedLabel(4, 3)!;
      line.writeText(el, text);
    }
    expect(line.stats.builds).toBe(1);
    expect(line.stats.writes).toBe(1);
  });

  it("D1 cadence: change N or k → exactly one new build and one write", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 120; frame++) {
      line.writeText(el, line.limitedLabel(4, 3)!);
    }
    expect(line.stats.builds).toBe(1);
    const text2 = line.limitedLabel(2, 3)!;
    line.writeText(el, text2);
    expect(line.stats.builds).toBe(2);
    expect(line.stats.writes).toBe(2);
    for (let frame = 0; frame < 60; frame++) {
      line.writeText(el, line.limitedLabel(2, 3)!);
    }
    expect(line.stats.builds).toBe(2);
    const text3 = line.limitedLabel(2, 2)!;
    line.writeText(el, text3);
    expect(line.stats.builds).toBe(3);
    expect(line.stats.writes).toBe(3);
  });
});
