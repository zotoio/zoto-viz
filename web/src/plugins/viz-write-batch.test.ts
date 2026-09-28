import { describe, expect, it } from "vitest";
import { defaultVizContract, VizBufferWriter } from "./viz-host";
import {
  applyVizWriteBatch,
  splitVizWriteBatch,
  validateVizWriteBatch,
  VIZ_WRITE_BATCH_MAX_MESSAGES,
} from "./viz-write-batch";

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

  it("splits oversized accumulated batches into consecutive legal chunks", () => {
    const buffers = Array.from({ length: 40 }, (_, i) => ({ slot: i, data: [i] }));
    const chunks = splitVizWriteBatch({ buffers, uniforms: [] });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((n, c) => n + c.buffers.length, 0)).toBe(40);
    for (const chunk of chunks) {
      expect(validateVizWriteBatch(chunk)).toBeNull();
      expect(chunk.buffers.length + chunk.uniforms.length).toBeLessThanOrEqual(VIZ_WRITE_BATCH_MAX_MESSAGES);
    }
  });
});
