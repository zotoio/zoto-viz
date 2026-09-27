import { afterEach, describe, expect, it } from "vitest";
import {
  onSmokePresentedFrame,
  readSmokePresentedFrames,
  smokeBackroomsHarnessArmed,
  smokeBackroomsSkyTime,
  smokeBackroomsWallClock,
  SMOKE_BACKROOMS_KEY,
  SMOKE_GOLDEN_TS,
  SMOKE_PRESENT_TARGET,
  SMOKE_SKY_TIME_S,
} from "./smoke-harness";

describe("smoke harness", () => {
  afterEach(() => {
    localStorage.removeItem(SMOKE_BACKROOMS_KEY);
    (window as unknown as { __zotoSmokePresentedFrames?: number }).__zotoSmokePresentedFrames = 0;
  });

  it("stays inert until armed", () => {
    expect(smokeBackroomsHarnessArmed()).toBe(false);
    expect(smokeBackroomsSkyTime()).toBeNull();
    expect(smokeBackroomsWallClock()).toBeNull();
    onSmokePresentedFrame();
    expect(readSmokePresentedFrames()).toBe(0);
  });

  it("pins clock and counts presents when armed", () => {
    localStorage.setItem(SMOKE_BACKROOMS_KEY, "1");
    expect(smokeBackroomsHarnessArmed()).toBe(true);
    expect(smokeBackroomsSkyTime()).toBe(SMOKE_SKY_TIME_S);
    expect(smokeBackroomsWallClock()?.toISOString()).toBe("2026-09-26T19:24:15.000Z");
    for (let i = 0; i < SMOKE_PRESENT_TARGET; i++) onSmokePresentedFrame();
    expect(readSmokePresentedFrames()).toBe(SMOKE_PRESENT_TARGET);
    expect(SMOKE_GOLDEN_TS).toBe(120);
  });
});
