import { beforeEach, describe, expect, it } from "vitest";
import { deliverMosaicDemoPacks, dropMosaicTileWriter } from "./mosaic-viz-feed";
import { modeById, setPluginModes, talkers, topology } from "../core/modes";
import type { VizDataFrame } from "../plugins/viz-host";

describe("deliverMosaicDemoPacks", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("writes UBO to each tile's scene", () => {
    setPluginModes([
      { ...topology, id: "plugin:star-sines", pluginId: "star-sines", label: "Sines" },
      { ...talkers, id: "plugin:kefrens-bars", pluginId: "kefrens-bars", label: "Kefrens" },
    ]);
    const uboByTile = new Map<string, Float32Array>();
    const mosaic = {
      tileIds: ["plugin:star-sines", "plugin:kefrens-bars"],
      graphScene: (id: string) => ({
        setPluginUboBuffer: (buf: Float32Array) => {
          uboByTile.set(id, buf);
        },
        setPluginUniform: () => true,
      }),
    };
    const frame = {
      t: 1,
      audio: 0.2,
      packets: [{ id: "a", rate: 10, role: "lan" }],
      talkers: [{ id: "b", rate: 20, role: "lan" }],
      rf: [],
      headlines: [],
    } as VizDataFrame;
    deliverMosaicDemoPacks(
      mosaic as never,
      frame,
      modeById,
      (id) => ({ id: id.replace("plugin:", ""), viz: { maxBuffers: 1, maxBufferFloats: 32, maxParticles: 0, uniforms: [] } }) as never,
      () => ({}),
    );
    expect(uboByTile.has("plugin:star-sines")).toBe(true);
    expect(uboByTile.has("plugin:kefrens-bars")).toBe(true);
    expect(uboByTile.get("plugin:star-sines")!.length).toBe(512);
    expect(uboByTile.get("plugin:kefrens-bars")!.length).toBe(512);
    expect(Array.from(uboByTile.get("plugin:star-sines")!).some((v) => v !== 0)).toBe(true);
    expect(Array.from(uboByTile.get("plugin:kefrens-bars")!).some((v) => v !== 0)).toBe(true);
    const sines = uboByTile.get("plugin:star-sines")!;
    const kef = uboByTile.get("plugin:kefrens-bars")!;
    expect(Array.from(sines).join(",")).not.toBe(Array.from(kef).join(","));
    dropMosaicTileWriter("plugin:star-sines");
  });
});
