import { describe, expect, it } from "vitest";
import { defaultVizContract, VizBufferWriter } from "./viz-host";
import { applyVizWriteBatch, validateVizWriteBatch } from "./viz-write-batch";

describe("viz write batch", () => {
  it("applies buffers and uniforms atomically", () => {
    const writer = new VizBufferWriter(defaultVizContract({ maxBuffers: 2 }));
    const ok = applyVizWriteBatch(writer, {
      buffers: [{ slot: 0, data: [1, 2, 3] }],
      uniforms: [{ name: "uBright", value: 0.8 }],
    }, {});
    expect(ok).toBe(true);
    expect(writer.ubo[0]).toBe(1);
    expect(validateVizWriteBatch({
      buffers: [{ slot: 0, data: new Array(900).fill(1) }],
      uniforms: [],
    })).toMatch(/bytes exceeds cap/);
  });
});
