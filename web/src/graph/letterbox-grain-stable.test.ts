import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasChangeProbe } from "./pane-change";
import { getSurfaceLetterboxFill, letterboxFillStats, paintLetterboxBarsInto, resetSurfaceLetterboxFillCache } from "./letterbox-fill";
import { zotoSurfacePanelClearHex } from "../core/themes";

describe("letterbox software grain stability", () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;

  beforeEach(() => {
    resetSurfaceLetterboxFillCache();
    letterboxFillStats.reset();
    canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    ctx = canvas.getContext("2d");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSurfaceLetterboxFillCache();
  });

  it("300 frames: 0 Math.random and 0 new strings from letterbox module hot path", () => {
    if (!ctx) return;
    const randomSpy = vi.spyOn(Math, "random");
    const fill = getSurfaceLetterboxFill(zotoSurfacePanelClearHex(), 0.25);
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
    randomSpy.mockRestore();
  });

  it("two identical frames: CanvasChangeProbe reports 0 change events on a bar pixel without grain", () => {
    if (!ctx) return;
    const fill = getSurfaceLetterboxFill(zotoSurfacePanelClearHex(), 0.25);
    const bars = [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ] as [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }];
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const inner = { x: 0, y: 22, w: 100, h: 56 };
    paintLetterboxBarsInto(ctx, box, inner, fill, bars);
    const probe = new CanvasChangeProbe();
    const rect = { x: 50, y: 5, w: 10, h: 10, __unit: "device" as const };
    probe.sample(ctx, canvas, rect);
    const changed = probe.sample(ctx, canvas, rect);
    expect(changed).toBe(false);
  });
});
