import { afterEach, describe, expect, it, vi } from "vitest";
import { setVizWallClockInjector, resetVizClockInjectors } from "../core/viz-clock";
import { resetNixieFormatterCache } from "./nixie-wall-clock";
import { resetNixiePackHostScope, runPackFrameHandler, VIZ_PACK_TILE_ID_OPT } from "./viz-pack-host";
import type { VizDataFrame } from "./viz-host";

const TILES = ["t0", "t1", "t2", "t3"];

function wallMsAtFrame(t0Ms: number, frame: number): number {
  return t0Ms + Math.floor((frame * 1000) / 60);
}

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

describe("nixie wall upload F1 (live pack path, 2×2, 60 fps)", () => {
  afterEach(() => {
    resetNixieFormatterCache();
    resetNixiePackHostScope();
    resetVizClockInjectors();
    vi.restoreAllMocks();
  });

  it("F1 seconds on: 10 wall seconds and 40 buffer uploads (10 per tile)", () => {
    const t0 = Date.parse("2024-06-15T12:00:00.000Z");
    const look = { format: "24", seconds: "1" };
    const writeBuffer = vi.fn();
    const bufAt1 = new Map<string, number[]>();
    for (let frame = 0; frame < 600; frame++) {
      setVizWallClockInjector(() => wallMsAtFrame(t0, frame));
      for (const tileId of TILES) {
        runPackFrameHandler("nixie-clock", emptyFrame(), {
          writeBuffer: (_slot, data) => {
            writeBuffer();
            if (frame === 1) bufAt1.set(tileId, data);
            if (frame === 599) expect(data).toBe(bufAt1.get(tileId));
          },
          writeUniform: () => {},
          writeParticles: () => {},
        }, { ...look, [VIZ_PACK_TILE_ID_OPT]: tileId });
      }
    }
    expect(writeBuffer).toHaveBeenCalledTimes(40);
  });

  it("F1 seconds off from 12:00:30: 10 wall seconds and 4 uploads (1 per tile)", () => {
    const t0 = Date.parse("2024-06-15T12:00:30.000Z");
    const look = { format: "24", seconds: "0" };
    const writeBuffer = vi.fn();
    for (let frame = 0; frame < 600; frame++) {
      setVizWallClockInjector(() => wallMsAtFrame(t0, frame));
      for (const tileId of TILES) {
        runPackFrameHandler("nixie-clock", emptyFrame(), {
          writeBuffer: () => writeBuffer(),
          writeUniform: () => {},
          writeParticles: () => {},
        }, { ...look, [VIZ_PACK_TILE_ID_OPT]: tileId });
      }
    }
    expect(writeBuffer).toHaveBeenCalledTimes(4);
  });
});
