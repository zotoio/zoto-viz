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

describe("LumaProbe.sampleForHealth five-patch read", () => {
  it("reads the centre plus each quadrant, so a flat Koi centre with fish at the edges is not uniform", async () => {
    const { patchesAreNearUniform } = await import("../plugins/tile-health");
    const probe = new LumaProbe(16, 60_000);
    const reads: [number, number][] = [];
    let bound: object | null = null;
    const pboAt = new Map<object, [number, number]>();
    const gl = {
      TIMEOUT_EXPIRED: 0x911c,
      WAIT_FAILED: 0x911d,
      PIXEL_PACK_BUFFER: 0x88eb,
      drawingBufferWidth: 400,
      drawingBufferHeight: 240,
      isContextLost: () => false,
      createBuffer: () => ({}),
      bufferData: vi.fn(),
      bindBuffer: (_t: number, b: object | null) => { bound = b; },
      readPixels: (x: number, y: number) => { reads.push([x, y]); pboAt.set(bound!, [x, y]); },
      fenceSync: vi.fn(() => ({})),
      clientWaitSync: vi.fn(() => 0x911a),
      deleteSync: vi.fn(),
      getBufferSubData: (_t: number, _o: number, dst: Uint8Array) => {
        const [x, y] = pboAt.get(bound!)!;
        const centre = x > 150 && x < 250 && y > 80 && y < 160;
        for (let i = 0; i < dst.length; i += 4) {
          const v = centre ? 40 : (i * 37) % 255;
          dst[i] = v; dst[i + 1] = v; dst[i + 2] = v; dst[i + 3] = 255;
        }
      },
      flush: vi.fn(),
    } as unknown as WebGL2RenderingContext;
    const vp = { x: 0, y: 0, w: 400, h: 240 };
    expect(probe.sampleForHealth(gl, vp, 0)).toBeNull();
    expect(reads).toHaveLength(5);
    expect(new Set(reads.map((r) => r.join(","))).size).toBe(5);
    const bytes = probe.sampleForHealth(gl, vp, 1)!;
    expect(bytes.length).toBe(5 * 16 * 16 * 4);
    expect(patchesAreNearUniform(bytes)).toBe(false);
  });
});
