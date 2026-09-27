import { beforeEach, describe, expect, it, vi } from "vitest";
import * as packHost from "../plugins/viz-pack-host";
import { deliverVizPluginFrame } from "./viz-frame-tick";
import type { VizDataFrame } from "../plugins/viz-host";

describe("deliverVizPluginFrame", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("calls sandbox.frame once per deliver", () => {
    const sandbox = { frame: vi.fn(), handlers: {} };
    const frame = { t: 1, audio: 0, packets: [], talkers: [], rf: [], headlines: [] } as VizDataFrame;
    deliverVizPluginFrame({
      frame,
      sandbox,
      packId: null,
      activeMode: { id: "x", pluginId: "ts-watch" } as never,
      optsFor: () => ({}),
      budgetStats: { lastMs: 0, overBudget: 0, skipped: 0, total: 0 },
    });
    expect(sandbox.frame).toHaveBeenCalledTimes(1);
  });

  it("demo pack uses runPackFrameHandler after sandbox.frame", () => {
    const sandbox = { frame: vi.fn(), handlers: {} };
    const packSpy = vi.spyOn(packHost, "runPackFrameHandler").mockImplementation(() => {});
    deliverVizPluginFrame({
      frame: { t: 1, audio: 0, packets: [], talkers: [], rf: [], headlines: [] } as VizDataFrame,
      sandbox,
      packId: "star-sines",
      activeMode: { id: "x", pluginId: "star-sines" } as never,
      optsFor: () => ({}),
      budgetStats: { lastMs: 0, overBudget: 0, skipped: 0, total: 0 },
    });
    expect(sandbox.frame).toHaveBeenCalledTimes(1);
    expect(packSpy).toHaveBeenCalledTimes(1);
    packSpy.mockRestore();
  });
});
