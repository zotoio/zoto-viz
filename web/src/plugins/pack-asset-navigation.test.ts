import { afterEach, describe, expect, it, vi } from "vitest";
import { packNavigationStopped } from "./plugin-copy";
import {
  applyPackNavigationStoppedNotice,
  markPackNavigationStopped,
  packNavigationStoppedForTile,
  resetPackAssetNavigationState,
} from "./pack-asset-navigation";
import { PackAssetTokenInvalidError } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import { beginActivePackLoad, resetPackAssetFrameState } from "./pack-asset-frame";
import * as rebuild from "./pack-asset-rebuild";
import { packFeedPaneNotice, resetPluginPackFeedState } from "./plugin-pack-feed";

describe("pack navigation stopped UX", () => {
  afterEach(() => {
    resetPackAssetNavigationState();
    resetPluginPackFeedState();
    resetPackAssetFrameState();
    vi.restoreAllMocks();
  });

  it("shows fail copy with only Remove from wall (no Retry)", () => {
    const tileId = "plugin:wifi";
    markPackNavigationStopped(tileId);
    const notice = packFeedPaneNotice(tileId, "Wi-Fi");
    expect(notice?.text).toBe(packNavigationStopped("Wi-Fi"));
    expect(notice?.recipe).toBe("fail");
    const mosaic = { setPaneNotice: vi.fn() };
    applyPackNavigationStoppedNotice(mosaic, tileId, "Wi-Fi");
    const opts = mosaic.setPaneNotice.mock.calls[0]?.[3];
    expect(opts?.showRemoveFromWall).toBe(true);
    expect(opts?.showRetry).toBeFalsy();
  });

  it("does not schedule token rebuild after navigation stop", async () => {
    const tileId = "plugin:wifi";
    markPackNavigationStopped(tileId);
    beginActivePackLoad(tileId, "Wi-Fi");
    const rebuildSpy = vi.spyOn(packAssetFrame, "beginTileRebuild");
    rebuild.setRebuildSleepForTests(async () => {});
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    vi.useFakeTimers();
    await rebuild.runPackAssetProtectedLoad(tileId, "Wi-Fi", mosaic, async () => {
      throw new PackAssetTokenInvalidError("token_invalid");
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuildSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
    rebuild.resetRebuildSleepForTests();
    rebuildSpy.mockRestore();
  });
});
