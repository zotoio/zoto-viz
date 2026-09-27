import { describe, expect, it, vi } from "vitest";
import { harvestGpu, timeGpu } from "./gpu-time";

describe("gpu-time", () => {
  it("runs draw without timing when the timer extension is missing", () => {
    const draw = vi.fn();
    const done = vi.fn();
    const gl = {
      getExtension: () => null,
      isContextLost: () => false,
    } as unknown as WebGL2RenderingContext;
    timeGpu(gl, draw, done);
    expect(draw).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled();
    harvestGpu();
    expect(done).not.toHaveBeenCalled();
  });

  it("runs draw without timing when createQuery fails", () => {
    const draw = vi.fn();
    const done = vi.fn();
    const gl = {
      getExtension: () => ({ TIME_ELAPSED_EXT: 0x88BF, GPU_DISJOINT_EXT: 0x8FBB }),
      createQuery: () => null,
      isContextLost: () => false,
    } as unknown as WebGL2RenderingContext;
    timeGpu(gl, draw, done);
    expect(draw).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled();
  });
});
