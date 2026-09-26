import { describe, expect, it, vi } from "vitest";
import { LumaProbe } from "./lumaProbe";
import { PaneChangeProbe } from "./pane-change";

function mockGl(): WebGL2RenderingContext & { errors: number[] } {
  const errors: number[] = [];
  const gl = {
    errors,
    drawingBufferWidth: 640,
    drawingBufferHeight: 480,
    isContextLost: () => false,
    FRAMEBUFFER: 0x8d40,
    PIXEL_PACK_BUFFER: 0x88eb,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    STREAM_READ: 0x88e0,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    bindFramebuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    readPixels: vi.fn(),
    fenceSync: vi.fn(() => ({})),
    getSyncParameter: vi.fn(() => 0x9119),
    deleteSync: vi.fn(),
    deleteBuffer: vi.fn(),
    getBufferSubData: vi.fn(),
    flush: vi.fn(),
    getError: vi.fn(function (this: { errors: number[] }) {
      return this.errors.shift() ?? 0;
    }),
  };
  return gl as unknown as WebGL2RenderingContext & { errors: number[] };
}

describe("luma and pane change probes", () => {
  it("lumaProbe issues readPixels on the default framebuffer without GL errors", () => {
    const gl = mockGl();
    const probe = new LumaProbe(8, 0);
    probe.tick(gl, 320, 240, 0);
    probe.tick(gl, 320, 240, 200);
    expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.readPixels).toHaveBeenCalled();
    expect(gl.getError()).toBe(0);
  });

  it("pane change probe stays error-free across a simulated view switch (context handoff)", () => {
    const glA = mockGl();
    const glB = mockGl();
    const probe = new PaneChangeProbe();
    const vp = { x: 10, y: 20, w: 200, h: 120 };
    probe.tick(glA, vp, 0, () => {});
    probe.tick(glA, vp, 16, () => {});
    probe.tick(glB, vp, 32, () => {});
    probe.tick(glB, vp, 48, () => {});
    expect(glA.bindFramebuffer).toHaveBeenCalled();
    expect(glB.bindFramebuffer).toHaveBeenCalled();
    expect(glA.getError()).toBe(0);
    expect(glB.getError()).toBe(0);
  });
});
