import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDevVizWallClockQuery } from "./viz-wall-clock-dev";
import { resetVizClockInjectors, vizWallMs } from "./viz-clock";

describe("DEV vizWallClock query", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vi.unstubAllEnvs();
  });

  it("W6: ?vizWallClock=13:05 pins wall ms in DEV", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallClockQuery("?vizWallClock=13:05");
    expect(vizWallMs()).toBe(Date.UTC(2024, 5, 15, 13, 5, 0, 0));
  });

  it("W6 prod: query is inert when not DEV", () => {
    vi.stubEnv("DEV", false);
    const before = vizWallMs();
    applyDevVizWallClockQuery("?vizWallClock=01:05");
    expect(vizWallMs()).toBe(before);
  });
});
