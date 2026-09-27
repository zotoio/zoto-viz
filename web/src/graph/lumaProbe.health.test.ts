import { describe, expect, it, vi } from "vitest";
import { LumaProbe } from "./lumaProbe";

describe("LumaProbe.sampleForHealth", () => {
  it("returns null when async read is pending so tile-health skips the check", () => {
    const probe = new LumaProbe(16, 60_000);
    const gl = {
      TIMEOUT_EXPIRED: 0x911c,
      WAIT_FAILED: 0x911d,
      NO_ERROR: 0,
      drawingBufferWidth: 200,
      drawingBufferHeight: 120,
      isContextLost: () => false,
      createBuffer: () => ({}),
      bufferData: vi.fn(),
      bindBuffer: vi.fn(),
      readPixels: vi.fn(),
      fenceSync: vi.fn(() => ({})),
      clientWaitSync: vi.fn(() => 0x911c),
      deleteSync: vi.fn(),
      getBufferSubData: vi.fn(),
      getError: () => 0,
      flush: vi.fn(),
    } as unknown as WebGL2RenderingContext;
    const vp = { x: 0, y: 0, w: 200, h: 120 };
    expect(probe.sampleForHealth(gl, vp, 0)).toBeNull();
    expect(probe.lastHarvestAt()).toBe(-1);
  });
});
