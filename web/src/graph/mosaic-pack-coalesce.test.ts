import { afterEach, describe, expect, it, vi } from "vitest";
import * as packHost from "../plugins/viz-pack-host";
import { deliverCoalescedMosaicPacks, mosaicPackGroups, resetMosaicPackCoalesceWriters } from "./mosaic-pack-coalesce";
import { setPluginModes, topology } from "../core/modes";
import type { VizDataFrame } from "../plugins/viz-host";
import type { NetScene } from "./scene";
import { mockPartial } from "../../test-support/mock-partial";

describe("mosaic pack coalesce", () => {
  afterEach(() => {
    setPluginModes([]);
    resetMosaicPackCoalesceWriters();
    vi.restoreAllMocks();
  });

  it("groups duplicate demo pack tiles with the first tile as primary", () => {
    setPluginModes([
      { ...topology, id: "plugin:star-sines", pluginId: "star-sines", label: "Sines" },
    ]);
    const groups = mosaicPackGroups(
      ["plugin:star-sines", "plugin:star-sines!1"],
      (id) => ({ pluginId: "star-sines", id }) as never,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primarySlot).toBe("plugin:star-sines");
    expect(groups[0]!.slots).toHaveLength(2);
  });

  it("runs one onFrame and one draw per pack per host frame with shared skip stats", () => {
    const uboBySlot = new Map<string, Float32Array>();
    const mosaic = {
      tileIds: ["plugin:star-sines", "plugin:star-sines!1"],
      graphScene: (slot: string) => mockPartial<NetScene>({
        setPluginUboBuffer: (buf: Float32Array) => { uboBySlot.set(slot, buf); },
        setPluginUniform: () => true,
        setPackCoalesce: () => {},
      }),
    };
    const frame: VizDataFrame = {
      t: 1,
      dt: 0,
      audio: 0.1,
      packets: [{ proto: "tcp", size: 10, field: 0.5 }],
      talkers: [],
      rf: [],
      headlines: [],
    };
    const budget = { stats: { lastMs: 1, overBudget: 0, skipped: 3, total: 4 } };
    const spy = vi.spyOn(packHost, "runPackFrameHandler").mockImplementation((_packId, _frame, handlers) => {
      handlers.writeBuffer(0, [1, 2, 3]);
    });
    deliverCoalescedMosaicPacks({
      mosaic,
      frame,
      modeById: (id) => ({ pluginId: "star-sines", id }) as never,
      pluginSpecForMode: () => ({
        id: "star-sines",
        viz: { maxBuffers: 1, maxBufferFloats: 32, maxParticles: 0, uniforms: [] },
      }) as never,
      optsFor: () => ({}),
      budget,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(uboBySlot.size).toBe(2);
    expect(budget.stats.skipped).toBe(3);
  });

  it("fan-out: one pack onFrame and one sandbox onFrame, UBO drawn on every duplicate tile", () => {
    const uboBySlot: string[] = [];
    const mosaic = {
      tileIds: ["plugin:star-sines", "plugin:star-sines!1"],
      graphScene: (slot: string) => mockPartial<NetScene>({
        setPluginUboBuffer: () => { uboBySlot.push(slot); },
        setPluginUniform: () => true,
        setPackCoalesce: () => {},
      }),
    };
    const onSandboxFrame = vi.fn();
    const onFrameSpy = vi.spyOn(packHost, "runPackFrameHandler").mockImplementation((_packId, _frame, handlers) => {
      handlers.writeBuffer(0, [1, 2, 3]);
    });
    deliverCoalescedMosaicPacks({
      mosaic,
      frame: {
        t: 1,
        dt: 0,
        audio: 0.1,
        packets: [],
        talkers: [],
        rf: [],
        headlines: [],
      },
      modeById: (id) => ({ pluginId: "star-sines", id }) as never,
      pluginSpecForMode: () => ({
        id: "star-sines",
        viz: { maxBuffers: 1, maxBufferFloats: 32, maxParticles: 0, uniforms: [] },
      }) as never,
      optsFor: () => ({}),
      budget: { stats: { lastMs: 0, overBudget: 0, skipped: 0, total: 0 } },
      onSandboxFrame,
    });
    expect(onFrameSpy).toHaveBeenCalledTimes(1);
    expect(onSandboxFrame).toHaveBeenCalledTimes(1);
    expect(uboBySlot.filter((s) => s === "plugin:star-sines")).toHaveLength(2);
    expect(uboBySlot).toContain("plugin:star-sines!1");
  });
});
