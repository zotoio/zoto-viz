import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyNixieWallClockQuery } from "./nixie-wall-flag-test-helper";
import { resetVizClockInjectors, setVizClockInjector, setVizWallClockInjector } from "../core/viz-clock";
import {
  bootNixieRealWallClock,
  clearDevWallFlagClock,
  nixieRealWallDateSingleton,
  nixieWallPartsScratch,
  resetNixieRealWallClockForTests,
} from "./nixie-wall-parts";
import { SharedNixieWallSecond } from "./nixie-wall-broadcast";
import { monoMs } from "../core/viz-time";
import { resetNixieFormatterCache } from "./nixie-wall-clock";
import { resetNixiePackHostScope, runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

describe("nixie wall clock source rows (B1 option b)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetVizClockInjectors();
    clearDevWallFlagClock();
    resetNixieRealWallClockForTests();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
  });

  afterEach(() => {
    resetVizClockInjectors();
    clearDevWallFlagClock();
    resetNixieRealWallClockForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("row 9 real clock: 600×16 ms frames, 0 new Date after boot, getters 10×", () => {
    const t0 = 1_700_000_000_000;
    let wall = t0;
    setVizWallClockInjector(() => wall);
    let mono = 0;
    setVizClockInjector(() => mono);

    bootNixieRealWallClock();
    const singleton = nixieRealWallDateSingleton();

    const dateCtor = vi.spyOn(globalThis, "Date");
    dateCtor.mockClear();
    const getHours = vi.spyOn(singleton, "getHours");
    const getMinutes = vi.spyOn(singleton, "getMinutes");
    const getSeconds = vi.spyOn(singleton, "getSeconds");

    const wallSecond = new SharedNixieWallSecond();
    for (let frame = 0; frame < 600; frame++) {
      wall = t0 + frame * 16;
      mono = frame * 16;
      wallSecond.syncWallSecond(monoMs(mono));
    }

    expect(dateCtor).not.toHaveBeenCalled();
    expect(getHours).toHaveBeenCalledTimes(10);
    expect(getMinutes).toHaveBeenCalledTimes(10);
    expect(getSeconds).toHaveBeenCalledTimes(10);
    expect(nixieRealWallDateSingleton()).toBe(singleton);
  });

  it("row 10 flag clock step: 01:05 + 3500 ms mono → {1,5,3} and one upload", () => {
    vi.stubEnv("DEV", true);
    let mono = 0;
    setVizClockInjector(() => mono);
    applyNixieWallClockQuery("?vizWallClock=01:05");
    mono = 3_500;
    const writeBuffer = vi.fn();
    runPackFrameHandler("nixie-clock", emptyFrame(), {
      writeBuffer: () => writeBuffer(),
      writeUniform: () => {},
      writeParticles: () => {},
    }, { format: "24", seconds: "1" });
    expect({ h: nixieWallPartsScratch.h, m: nixieWallPartsScratch.m, s: nixieWallPartsScratch.s }).toEqual({
      h: 1,
      m: 5,
      s: 3,
    });
    expect(writeBuffer).toHaveBeenCalledTimes(1);
  });

  it("row 11 midnight wrap: 23:59 + 61000 ms → 00:00:01, tubes 12 00, one upload", () => {
    vi.stubEnv("DEV", true);
    let mono = 0;
    setVizClockInjector(() => mono);
    applyNixieWallClockQuery("?vizWallClock=23:59");
    mono = 61_000;
    let digits: number[] = [];
    const writeBuffer = vi.fn((_slot, data) => {
      digits = data.slice(0, 4);
    });
    runPackFrameHandler("nixie-clock", emptyFrame(), {
      writeBuffer,
      writeUniform: () => {},
      writeParticles: () => {},
    }, { format: "12", seconds: "0" });
    expect({ h: nixieWallPartsScratch.h, m: nixieWallPartsScratch.m, s: nixieWallPartsScratch.s }).toEqual({
      h: 0,
      m: 0,
      s: 1,
    });
    expect(digits).toEqual([1, 2, 0, 0]);
    expect(writeBuffer).toHaveBeenCalledTimes(1);
  });
});
