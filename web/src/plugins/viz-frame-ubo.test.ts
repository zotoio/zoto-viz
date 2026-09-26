import { describe, expect, it } from "vitest";
import {
  VIZ_FRAME_UBO,
  VIZ_FRAME_UBO_VERSION,
  readVizFrameRenderScale,
  writeVizFrameUbo,
} from "./viz-frame-ubo";

describe("viz frame UBO layout", () => {
  it("pins renderScale at offset 0 and layout version at offset 1", () => {
    expect(VIZ_FRAME_UBO.renderScaleOffset).toBe(0);
    expect(VIZ_FRAME_UBO.layoutVersionOffset).toBe(1);
    expect(VIZ_FRAME_UBO.version).toBe(VIZ_FRAME_UBO_VERSION);
  });

  it("writes and reads render scale without allocation", () => {
    const buf = new Float32Array(4);
    writeVizFrameUbo(buf, 0.75);
    expect(buf[0]).toBe(0.75);
    expect(buf[1]).toBe(VIZ_FRAME_UBO_VERSION);
    expect(readVizFrameRenderScale(buf)).toBe(0.75);
  });
});
