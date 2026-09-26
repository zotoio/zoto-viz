import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetVizClockInjectors,
  setVizClockInjector,
  setVizWallClockInjector,
} from "../core/viz-clock";
import {
  createNixieWallClock,
  digitsFromWallMs,
  nixieSimWallMs,
  packNixieWallBuffer,
  resetNixieFormatterCache,
} from "./nixie-wall-clock";
import { DEFAULT_LOOK } from "../../../plugins/src/nixie-clock/frontend/tubes";

const SYDNEY = "Australia/Sydney";
describe("nixie wall clock rows", () => {
  afterEach(() => {
    resetVizClockInjectors();
    resetNixieFormatterCache();
    vi.restoreAllMocks();
  });

  it("N1: 600 frames — format at [0,60,…,540], one formatter, stable buffer", () => {
    resetNixieFormatterCache();
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const clock = createNixieWallClock(SYDNEY);
    const t0 = 1_700_000_000_000;
    const formatFrames: number[] = [];
    let prevCalls = 0;
    let bufRef: number[] | null = null;
    for (let i = 0; i < 600; i++) {
      const wallMs = nixieSimWallMs(t0, i);
      const buf = clock.tick(wallMs, DEFAULT_LOOK);
      if (clock.formatCalls > prevCalls) {
        formatFrames.push(i);
        prevCalls = clock.formatCalls;
      }
      expect(buf).toBe(clock.digitBuffer);
      if (!bufRef) bufRef = buf;
      else expect(buf).toBe(bufRef);
    }
    expect(spy.mock.calls.filter((c) => c[1]?.timeZone === SYDNEY)).toHaveLength(1);
    expect(formatFrames).toEqual([0, 60, 120, 180, 240, 300, 360, 420, 480, 540]);
    for (const i of [1, 17, 60, 119]) {
      expect(nixieSimWallMs(t0, i)).toBe(t0 + Math.floor((i * 5000) / 300));
    }
  });

  it("N2: Sydney DST spring — 01:59:59 to 03:00:00", () => {
    const look = { ...DEFAULT_LOOK, hour12: false };
    const before = Date.parse("2026-10-03T15:59:59.000Z");
    const after = Date.parse("2026-10-03T16:00:00.000Z");
    const d0 = digitsFromWallMs(before, look, SYDNEY);
    const d1 = digitsFromWallMs(after, look, SYDNEY);
    expect(d0).toEqual([0, 1, 5, 9, 5, 9]);
    expect(d1).toEqual([0, 3, 0, 0, 0, 0]);
  });

  it("N3: after reload, the display still shows the local wall hour, not page uptime", async () => {
    const wallMs = Date.parse("2026-06-15T14:30:00.000Z") + 500;
    resetVizClockInjectors();
    setVizWallClockInjector(() => wallMs);
    setVizClockInjector(() => 42_000);
    resetNixieFormatterCache();
    const mod = await import("./nixie-wall-clock");
    const clock = mod.createNixieWallClock(SYDNEY);
    const expected = mod.digitsFromWallMs(wallMs, DEFAULT_LOOK, SYDNEY);
    const uptimeDigits = mod.digitsFromWallMs(42_000, DEFAULT_LOOK, SYDNEY);
    mod.packNixieWallBuffer(clock, DEFAULT_LOOK);
    expect(clock.digitBuffer.slice(0, 6)).toEqual(expected);
    expect(clock.digitBuffer.slice(0, 6)).not.toEqual(uptimeDigits);
  });
});
