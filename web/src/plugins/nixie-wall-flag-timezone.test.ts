import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDevVizWallFlagsOnBuild } from "../core/viz-dev-wall-flags";
import { resetVizClockInjectors, vizWallMs } from "../core/viz-clock";
import { digitsFromWallMs, resetNixieFormatterCache } from "./nixie-wall-clock";
import { parseNixieLook } from "../../../shared/nixie-tubes";
import * as nixieTz from "./nixie-wall-timezone";
import { resetNixiePackHostScope, runPackFrameHandler } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

function digitsViaFlag(timeZone: string, clock: string, hour12: boolean): number[] {
  vi.stubEnv("DEV", true);
  vi.spyOn(nixieTz, "hostLocalTimeZone").mockReturnValue(timeZone);
  const [hh, mm] = clock.split(":").map((x) => Number(x));
  const t0 = nixieTz.wallEpochMsForParts(2024, 6, 15, hh, mm, 0, timeZone);
  vi.spyOn(Date, "now").mockImplementation(() => t0);
  applyDevVizWallFlagsOnBuild(`?vizWallClock=${clock}`, ["main"]);
  const look = parseNixieLook({ format: hour12 ? "12" : "24", seconds: "0" });
  let buf: number[] = [];
  runPackFrameHandler("nixie-clock", emptyFrame(), {
    writeBuffer: (_s, d) => { buf = d; },
    writeUniform: () => {},
    writeParticles: () => {},
  }, { format: hour12 ? "12" : "24", seconds: "0" });
  expect(vizWallMs()).toBeGreaterThan(0);
  return buf.slice(0, 6);
}

describe("nixie ?vizWallClock= flag timezone parity", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetVizClockInjectors();
    nixieTz.resetNixieWallDisplayTimeZone();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
  });

  afterEach(() => {
    resetVizClockInjectors();
    nixieTz.resetNixieWallDisplayTimeZone();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Australia/Sydney 01:05 12h → [-1,1,0,5]", () => {
    expect(digitsViaFlag("Australia/Sydney", "01:05", true)).toEqual([-1, 1, 0, 5, 0, 0]);
  });

  it("Australia/Sydney 00:05 12h → 12 05", () => {
    expect(digitsViaFlag("Australia/Sydney", "00:05", true)).toEqual([1, 2, 0, 5, 0, 0]);
  });

  it("Australia/Sydney 12:05 12h → 12 05", () => {
    expect(digitsViaFlag("Australia/Sydney", "12:05", true)).toEqual([1, 2, 0, 5, 0, 0]);
  });

  it("Australia/Sydney 13:05 12h → [-1,1,0,5]", () => {
    expect(digitsViaFlag("Australia/Sydney", "13:05", true)).toEqual([-1, 1, 0, 5, 0, 0]);
  });

  it("Australia/Sydney 00:05 24h → 00 05", () => {
    expect(digitsViaFlag("Australia/Sydney", "00:05", false)).toEqual([0, 0, 0, 5, 0, 0]);
  });

  it("America/New_York 01:05 12h → [-1,1,0,5]", () => {
    expect(digitsViaFlag("America/New_York", "01:05", true).slice(0, 4)).toEqual([-1, 1, 0, 5]);
  });

  it("E: digitsFromParts matches flag path in UTC", () => {
    const look = parseNixieLook({ format: "12", seconds: "0" });
    const ms = nixieTz.wallEpochMsForParts(2024, 6, 15, 1, 5, 0, "UTC");
    expect(digitsFromWallMs(ms, look, "UTC").slice(0, 4)).toEqual([-1, 1, 0, 5]);
  });
});
