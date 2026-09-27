import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDevVizWallFlagsOnBuild } from "../core/viz-dev-wall-flags";
import { setVizClockInjector, resetVizClockInjectors } from "../core/viz-clock";
import { resetNixieFormatterCache } from "./nixie-wall-clock";
import { resetNixiePackHostScope, runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

describe("nixie wall upload F1 (live pack path, 60 fps)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    resetNixieFormatterCache();
    resetNixiePackHostScope();
    resetVizClockInjectors();
    vi.restoreAllMocks();
  });

  it("F1 seconds on: 10 wall seconds and 10 buffer uploads (one call per frame)", () => {
    vi.stubEnv("DEV", true);
    const look = { format: "24", seconds: "1" };
    const writeBuffer = vi.fn();
    let mono = 0;
    setVizClockInjector(() => mono);
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", ["main"]);
    let firstBuf: number[] | undefined;
    for (let frame = 0; frame < 600; frame++) {
      mono += 1000 / 60;
      runPackFrameHandler("nixie-clock", emptyFrame(), {
        writeBuffer: (_slot, data) => {
          writeBuffer();
          if (frame === 1) firstBuf = data;
          if (frame === 599 && firstBuf) expect(data).toBe(firstBuf);
        },
        writeUniform: () => {},
        writeParticles: () => {},
      }, look);
    }
    expect(writeBuffer).toHaveBeenCalledTimes(10);
  });

  it("F1 seconds off from 12:00:30: one upload per minute step", () => {
    vi.stubEnv("DEV", true);
    const look = { format: "24", seconds: "0" };
    const writeBuffer = vi.fn();
    let mono = 30_000;
    setVizClockInjector(() => mono);
    applyDevVizWallFlagsOnBuild("?vizWallClock=12:00", ["main"]);
    for (let frame = 0; frame < 600; frame++) {
      mono += 1000 / 60;
      runPackFrameHandler("nixie-clock", emptyFrame(), {
        writeBuffer: () => writeBuffer(),
        writeUniform: () => {},
        writeParticles: () => {},
      }, look);
    }
    expect(writeBuffer).toHaveBeenCalledTimes(1);
  });
});
