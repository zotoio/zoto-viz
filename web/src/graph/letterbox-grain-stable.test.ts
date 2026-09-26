/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasChangeProbe } from "./pane-change";
import { getSurfaceLetterboxFill, letterboxFillStats, paintLetterboxBarsInto } from "./letterbox-fill";
import { zotoSurfacePanelClearHex } from "../core/themes";

function stub2dContext(): CanvasRenderingContext2D {
  const state = { fillStyle: "" };
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: string) { state.fillStyle = v; },
  } as unknown as CanvasRenderingContext2D;
}

describe("letterbox software grain stability", () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    letterboxFillStats.reset();
    canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    ctx = stub2dContext();
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    letterboxFillStats.reset();
  });

  it("300 frames: 0 Math.random and 0 new strings from letterbox module hot path", () => {
    const randomSpy = vi.spyOn(Math, "random");
    const fill = getSurfaceLetterboxFill(zotoSurfacePanelClearHex(), 0.25);
    const strBefore = letterboxFillStats.stringAllocations;
    const bars = [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ] as [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }];
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const inner = { x: 0, y: 22, w: 100, h: 56 };
    for (let i = 0; i < 300; i++) {
      paintLetterboxBarsInto(ctx, box, inner, fill, bars);
    }
    expect(randomSpy).not.toHaveBeenCalled();
    expect(letterboxFillStats.stringAllocations).toBe(strBefore);
    randomSpy.mockRestore();
  });

  it("two identical frames: CanvasChangeProbe reports 0 change events on a bar pixel without grain", () => {
    const realCtx = stub2dContext();
    const image = new Uint8ClampedArray(16 * 16 * 4);
    image.fill(20);
    realCtx.getImageData = vi.fn(() => ({ data: image, width: 16, height: 16 } as ImageData));
    vi.spyOn(canvas, "getContext").mockReturnValue(realCtx);

    const fill = getSurfaceLetterboxFill(zotoSurfacePanelClearHex(), 0.25);
    const bars = [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ] as [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }];
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const inner = { x: 0, y: 22, w: 100, h: 56 };
    paintLetterboxBarsInto(realCtx, box, inner, fill, bars);
    const probe = new CanvasChangeProbe();
    const rect = { x: 50, y: 5, w: 10, h: 10, __unit: "device" as const };
    probe.sample(realCtx, canvas, rect);
    const changed = probe.sample(realCtx, canvas, rect);
    expect(changed).toBe(false);
  });
});
