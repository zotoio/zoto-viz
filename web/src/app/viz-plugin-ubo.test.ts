import { describe, expect, it, vi } from "vitest";
import { broadcastPluginUbo } from "./viz-plugin-ubo";

describe("viz plugin UBO broadcast", () => {
  it("F1: nixie buffer reaches header and a non-header mosaic graph scene", () => {
    const buf = new Float32Array([1, 2, 3]);
    const main = { setPluginUboBuffer: vi.fn() };
    const wall = { setPluginUboBuffer: vi.fn() };
    const mosaic = {
      tileIds: ["header", "wall-a"],
      graphScene: (id: string) => (id === "wall-a" ? wall : null),
    };
    broadcastPluginUbo(main, buf, mosaic);
    expect(main.setPluginUboBuffer).toHaveBeenCalledWith(buf);
    expect(wall.setPluginUboBuffer).toHaveBeenCalledWith(buf);
    expect(wall.setPluginUboBuffer).toHaveBeenCalledTimes(1);
  });
});
