import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";
import { runPackAssetProtectedLoad } from "./pack-asset-rebuild";
import { PackAssetTokenInvalidError } from "../core/http";
import {
  openPackAssetFrame,
  packAssetFrameOpenCount,
  resetPackAssetFrameState,
} from "./pack-asset-frame";

describe("wall notice on secret rotation", () => {
  afterEach(() => {
    resetPackAssetFrameState();
    vi.useRealTimers();
  });

  it("shows one wall notice when eight tiles hit a token_invalid rebuild", async () => {
    vi.useFakeTimers();
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    const tiles = Array.from({ length: 8 }, (_, i) => `plugin:t${i}`);
    let rotationFrames = 0;
    for (const tileId of tiles) {
      let calls = 0;
      const p = runPackAssetProtectedLoad(tileId, "Pack", mosaic, async () => {
        calls += 1;
        if (calls === 1) throw new PackAssetTokenInvalidError("demo");
        await openPackAssetFrame(tileId);
        rotationFrames += 1;
      }, { serverRestart: true });
      await vi.runAllTimersAsync();
      await p;
    }
    expect(mosaic.setWallNotice).toHaveBeenCalledTimes(1);
    expect(mosaic.setWallNotice.mock.calls[0]?.[0]).toBe(SERVER_RESTART_WALL_NOTICE);
    expect(rotationFrames).toBe(8);
    for (const tileId of tiles) {
      expect(packAssetFrameOpenCount(tileId)).toBe(1);
    }
  });
});
