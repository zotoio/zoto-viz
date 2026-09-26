import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOK } from "../../../shared/nixie-tubes";
import { resetNixieFormatterCache } from "./nixie-wall-clock";
import {
  createNixieWallBroadcast,
  nixieWallBroadcastRevertOnSecond,
} from "./nixie-wall-broadcast";

const UTC = "UTC";
const TILES = ["t0", "t1", "t2", "t3"];

function wallMsAtFrame(t0Ms: number, frame: number): number {
  return t0Ms + Math.floor((frame * 1000) / 60);
}

describe("nixie wall broadcast F1 (2×2, 60 fps)", () => {
  afterEach(() => {
    resetNixieFormatterCache();
    vi.restoreAllMocks();
  });

  it("F1 seconds on: 10 wall reads and 40 uploads (10 per tile)", () => {
    const t0 = Date.parse("2024-06-15T12:00:00.000Z");
    const look = { ...DEFAULT_LOOK, hour12: false, seconds: true };
    const broadcast = createNixieWallBroadcast(TILES);
    let totalUploads = 0;
    const bufAt1 = new Map<string, number[]>();
    for (let frame = 0; frame < 600; frame++) {
      const wallMs = wallMsAtFrame(t0, frame);
      totalUploads += broadcast.frame(
        frame,
        wallMs,
        () => look,
        (id, data) => {
          if (frame === 1) bufAt1.set(id, data);
          if (frame === 599) expect(data).toBe(bufAt1.get(id));
        },
        UTC,
      );
    }
    expect(broadcast.shared.wallReads).toBe(10);
    expect(totalUploads).toBe(40);
    for (const tile of broadcast.tiles) expect(tile.uploads).toBe(10);
  });

  it("F1 seconds off from 12:00:30: 10 wall reads and 4 uploads (1 per tile)", () => {
    const t0 = Date.parse("2024-06-15T12:00:30.000Z");
    const look = { ...DEFAULT_LOOK, hour12: false, seconds: false };
    const broadcast = createNixieWallBroadcast(TILES);
    let totalUploads = 0;
    for (let frame = 0; frame < 600; frame++) {
      totalUploads += broadcast.frame(
        frame,
        wallMsAtFrame(t0, frame),
        () => look,
        () => {},
        UTC,
      );
    }
    expect(broadcast.shared.wallReads).toBe(10);
    expect(totalUploads).toBe(4);
    for (const tile of broadcast.tiles) expect(tile.uploads).toBe(1);
  });

  it("F1 revert seconds off: upload every second → 10 per tile (red vs 1 expected)", () => {
    const t0 = Date.parse("2024-06-15T12:00:30.000Z");
    const look = { ...DEFAULT_LOOK, hour12: false, seconds: false };
    const broadcast = createNixieWallBroadcast(TILES);
    for (let frame = 0; frame < 600; frame++) {
      nixieWallBroadcastRevertOnSecond(
        broadcast,
        frame,
        wallMsAtFrame(t0, frame),
        () => look,
        () => {},
        UTC,
      );
    }
    for (const tile of broadcast.tiles) expect(tile.uploads).toBe(10);
  });
});
