import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDevVizWallFlagsOnBuild } from "../core/viz-dev-wall-flags";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { clearDevWallFlagClock } from "./nixie-wall-parts";
import { resetNixieFormatterCache } from "./nixie-wall-clock";
import { resetNixiePackHostScope, runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

function digitsViaFlag(clock: string, hour12: boolean): number[] {
  vi.stubEnv("DEV", true);
  let mono = 0;
  setVizClockInjector(() => mono);
  applyDevVizWallFlagsOnBuild(`?vizWallClock=${clock}`, ["main"]);
  const look = { format: hour12 ? "12" : "24", seconds: "0" };
  let buf: number[] = [];
  runPackFrameHandler("nixie-clock", emptyFrame(), {
    writeBuffer: (_s, d) => { buf = d; },
    writeUniform: () => {},
    writeParticles: () => {},
  }, look);
  return buf.slice(0, 6);
}

describe("nixie ?vizWallClock= flag (mono second clock)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetVizClockInjectors();
    clearDevWallFlagClock();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
  });

  afterEach(() => {
    resetVizClockInjectors();
    clearDevWallFlagClock();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("12h 01:05 → blank tens, 1, 05", () => {
    expect(digitsViaFlag("01:05", true).slice(0, 4)).toEqual([-1, 1, 0, 5]);
  });

  it("12h 00:05 → 12 05", () => {
    expect(digitsViaFlag("00:05", true).slice(0, 4)).toEqual([1, 2, 0, 5]);
  });

  it("12h 12:05 → 12 05", () => {
    expect(digitsViaFlag("12:05", true).slice(0, 4)).toEqual([1, 2, 0, 5]);
  });

  it("12h 13:05 → blank tens, 1, 05", () => {
    expect(digitsViaFlag("13:05", true).slice(0, 4)).toEqual([-1, 1, 0, 5]);
  });

  it("24h 00:05 → 00 05", () => {
    expect(digitsViaFlag("00:05", false).slice(0, 4)).toEqual([0, 0, 0, 5]);
  });

  it("two pack calls at 13:05 share one upload latch (one writeBuffer)", () => {
    vi.stubEnv("DEV", true);
    let mono = 0;
    setVizClockInjector(() => mono);
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", ["a", "b"]);
    const look = { format: "24", seconds: "0" };
    const writeBuffer = vi.fn();
    runPackFrameHandler("nixie-clock", emptyFrame(), {
      writeBuffer: () => writeBuffer(),
      writeUniform: () => {},
      writeParticles: () => {},
    }, look);
    runPackFrameHandler("nixie-clock", emptyFrame(), {
      writeBuffer: () => writeBuffer(),
      writeUniform: () => {},
      writeParticles: () => {},
    }, look);
    expect(writeBuffer).toHaveBeenCalledTimes(1);
  });
});
