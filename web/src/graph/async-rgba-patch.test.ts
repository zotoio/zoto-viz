import { describe, expect, it, vi } from "vitest";
import { AsyncRgbaPatchProbe } from "./async-rgba-patch";

function mockGl(over: Partial<WebGL2RenderingContext> & {
  wait?: number;
  drawingBufferWidth?: number;
  drawingBufferHeight?: number;
} = {}): WebGL2RenderingContext {
  const TIMEOUT_EXPIRED = 0x911c;
  const WAIT_FAILED = 0x911d;
  const NO_ERROR = 0;
  const SYNC_GPU_COMMANDS_COMPLETE = 0x9117;
  const PIXEL_PACK_BUFFER = 0x88eb;
  const RGBA = 0x1908;
  const UNSIGNED_BYTE = 0x1401;
  const STREAM_READ = 0x88e0;
  const SIGNALED = 0x9119;
  let syncObj: WebGLSync | null = null;
  const buffer = {};
  return {
    TIMEOUT_EXPIRED,
    WAIT_FAILED,
    NO_ERROR,
    SYNC_GPU_COMMANDS_COMPLETE,
    PIXEL_PACK_BUFFER,
    RGBA,
    UNSIGNED_BYTE,
    STREAM_READ,
    SIGNALED,
    drawingBufferWidth: over.drawingBufferWidth ?? 256,
    drawingBufferHeight: over.drawingBufferHeight ?? 256,
    isContextLost: () => false,
    createBuffer: () => buffer as WebGLBuffer,
    bufferData: vi.fn(),
    bindBuffer: vi.fn(),
    readPixels: vi.fn(),
    fenceSync: vi.fn(() => {
      syncObj = {} as WebGLSync;
      return syncObj;
    }),
    clientWaitSync: vi.fn(() => over.wait ?? TIMEOUT_EXPIRED),
    deleteSync: vi.fn(() => { syncObj = null; }),
    getBufferSubData: vi.fn(),
    getError: () => NO_ERROR,
    flush: vi.fn(),
    ...over,
  } as WebGL2RenderingContext;
}

describe("AsyncRgbaPatchProbe", () => {
  it("does not harvest when clientWaitSync times out", () => {
    const gl = mockGl();
    const probe = new AsyncRgbaPatchProbe(4);
    expect(probe.issue(gl, 10, 10)).toBe(true);
    expect(probe.pending).toBe(true);
    expect(probe.tryHarvest(gl)).toBe(false);
    expect(probe.harvestedAt).toBe(-1);
  });

  it("harvests when the fence is ready without blocking", () => {
    const gl = mockGl({ wait: 0x911b }); // CONDITION_SATISFIED
    const probe = new AsyncRgbaPatchProbe(4);
    probe.issue(gl, 0, 0);
    expect(probe.tryHarvest(gl)).toBe(true);
    expect(probe.harvestedAt).toBeGreaterThan(0);
    expect(probe.pending).toBe(false);
  });
});
