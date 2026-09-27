import { beforeEach, describe, expect, it, vi } from "vitest";
import * as packHost from "../plugins/viz-pack-host";
import * as coalesce from "../graph/mosaic-pack-coalesce";
import { deliverVizPluginFrame } from "./viz-frame-tick";
import type { VizDataFrame } from "../plugins/viz-host";

describe("deliverVizPluginFrame", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("mosaic with demo + TS plugin: exactly one sandbox.frame per frame over 10 frames", () => {
    const sandbox = { frame: vi.fn(), handlers: {} };
    const deliverSpy = vi.spyOn(coalesce, "deliverCoalescedMosaicPacks").mockImplementation(() => {});
    const frameBase = {
      t: 0,
      audio: 0,
      packets: [],
      talkers: [],
      rf: [],
      headlines: [],
    } as VizDataFrame;
    const mosaic = {
      on: true,
      tileIds: ["plugin:star-sines", "plugin:ts-watch"],
      graphScene: () => null,
    };
    for (let i = 0; i < 10; i++) {
      deliverVizPluginFrame({
        frame: { ...frameBase, t: i },
        sandbox,
        mosaic,
        mosaicDemoPacks: true,
        packId: null,
        activeMode: { id: "x", pluginId: "ts-watch" } as never,
        modeById: (id) => ({ id, pluginId: id.includes("star") ? "star-sines" : "ts-watch" }) as never,
        mosaicTileViewId: (slot) => slot,
        pluginSpecForMode: () => null,
        optsFor: () => ({}),
        budgetStats: { lastMs: 0, overBudget: 0, skipped: 0, total: 0 },
      });
    }
    expect(sandbox.frame).toHaveBeenCalledTimes(10);
    expect(deliverSpy).toHaveBeenCalledTimes(10);
    deliverSpy.mockRestore();
  });

  it("non-mosaic demo pack still uses sandbox.frame once", () => {
    const sandbox = { frame: vi.fn(), handlers: {} };
    const packSpy = vi.spyOn(packHost, "runPackFrameHandler").mockImplementation(() => {});
    deliverVizPluginFrame({
      frame: { t: 1, audio: 0, packets: [], talkers: [], rf: [], headlines: [] } as VizDataFrame,
      sandbox,
      mosaic: null,
      mosaicDemoPacks: false,
      packId: "star-sines",
      activeMode: { id: "x", pluginId: "star-sines" } as never,
      modeById: () => ({ id: "x", pluginId: "star-sines" }) as never,
      mosaicTileViewId: (s) => s,
      pluginSpecForMode: () => null,
      optsFor: () => ({}),
      budgetStats: { lastMs: 0, overBudget: 0, skipped: 0, total: 0 },
    });
    expect(sandbox.frame).toHaveBeenCalledTimes(1);
    expect(packSpy).toHaveBeenCalledTimes(1);
    packSpy.mockRestore();
  });
});
