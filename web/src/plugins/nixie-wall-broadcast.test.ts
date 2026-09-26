import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVizWallClockInjector, resetVizClockInjectors } from "../core/viz-clock";
import { resetNixieFormatterCache } from "./nixie-wall-clock";
import { resetNixiePackHostScope, runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

function wallMsAtFrame(t0Ms: number, frame: number): number {
  return t0Ms + Math.floor((frame * 1000) / 60);
}

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

  it("F1 seconds on: 10 wall seconds and 10 buffer uploads", () => {
    const t0 = Date.parse("2024-06-15T12:00:00.000Z");
    const look = { format: "24", seconds: "1" };
    const writeBuffer = vi.fn();
    let firstBuf: number[] | undefined;
    for (let frame = 0; frame < 600; frame++) {
      setVizWallClockInjector(() => wallMsAtFrame(t0, frame));
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
    const t0 = Date.parse("2024-06-15T12:00:30.000Z");
    const look = { format: "24", seconds: "0" };
    const writeBuffer = vi.fn();
    for (let frame = 0; frame < 600; frame++) {
      setVizWallClockInjector(() => wallMsAtFrame(t0, frame));
      runPackFrameHandler("nixie-clock", emptyFrame(), {
        writeBuffer: () => writeBuffer(),
        writeUniform: () => {},
        writeParticles: () => {},
      }, look);
    }
    expect(writeBuffer).toHaveBeenCalledTimes(1);
  });
});
