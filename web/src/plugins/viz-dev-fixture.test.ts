import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildVizDevFixtureFrame,
  parseVizDevFixtureQuery,
  VIZ_DEV_FIXTURE_NAMES,
} from "./viz-dev-fixture";
import { buildIdleVizFrameFailed } from "./fixtures/idle-viz-frame";
import {
  buildVizSdkGoldenLiveFrame,
  buildVizSdkIdleFrame,
  buildVizSdkVmLiveFrame,
} from "./fixtures/viz-sdk-frame-build";

function stripClock(frame: ReturnType<typeof buildVizSdkIdleFrame>) {
  const { t: _t, dt: _dt, audio: _a, ...rest } = frame;
  return rest;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("parseVizDevFixtureQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores the param when dev is false (production path)", () => {
    for (const name of VIZ_DEV_FIXTURE_NAMES) {
      expect(parseVizDevFixtureQuery(`?vizFixture=${name}`, false)).toBeNull();
    }
    expect(parseVizDevFixtureQuery("?vizFixture=golden-live", false)).toBeNull();
  });

  it("selects each known fixture name in dev", () => {
    for (const name of VIZ_DEV_FIXTURE_NAMES) {
      expect(parseVizDevFixtureQuery(`?vizFixture=${name}`, true)).toBe(name);
      expect(parseVizDevFixtureQuery(`?other=1&vizFixture=${name}&x=2`, true)).toBe(name);
    }
  });

  it("warns and ignores unknown values in dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseVizDevFixtureQuery("?vizFixture=not-a-fixture", true)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[zoto-viz] unknown vizFixture="not-a-fixture" (ignored)');
  });
});

describe("buildVizDevFixtureFrame", () => {
  it("maps each dev fixture name to the shared host builders", () => {
    const t = 42;
    const dt = 0.016;
    const audio = 0.25;

    expect(stripClock(buildVizDevFixtureFrame("idle", t, dt, audio))).toEqual(
      stripClock(buildVizSdkIdleFrame()),
    );
    expect(stripClock(buildVizDevFixtureFrame("golden-live", t, dt, audio))).toEqual(
      stripClock(buildVizSdkGoldenLiveFrame()),
    );
    expect(stripClock(buildVizDevFixtureFrame("vm-live", t, dt, audio))).toEqual(
      stripClock(buildVizSdkVmLiveFrame()),
    );

    const failed = buildVizDevFixtureFrame("idle-failed", t, dt, audio);
    expect(stripClock(failed)).toEqual(stripClock(buildIdleVizFrameFailed(t, dt)));
    expect(failed.t).toBe(t);
    expect(failed.dt).toBe(dt);
    expect(failed.audio).toBe(audio);
  });
});
