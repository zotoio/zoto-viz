import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import * as pluginModule from "./plugin";
import type { PluginView } from "./plugin";

describe("pack navigation stopped UX", () => {
  afterEach(() => {
    resetPackAssetNavigationState();
    resetPluginPackFeedState();
    resetPackAssetFrameState();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("navigation guard counts", () => {
    const tileA = "plugin:wifi";
    const tileB = "plugin:heat";
    const wifiSpec: PluginView = { id: "wifi", name: "Wi-Fi", version: 1 };
    const heatSpec: PluginView = { id: "heat", name: "Heat map", version: 1 };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("coalesces blocked navigation pane notice work per tile", () => {
      const paneA = document.createElement("div");
      const paneB = document.createElement("div");
      document.body.append(paneA, paneB);
      const textWrite = vi.fn();
      const tileDisplayNameSpy = vi.spyOn(pluginModule, "tileDisplayName");
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      let noticeCount = 0;
      const mosaic = {
        setPaneNotice: (id: string, text: string | null | undefined) => {
          if (text) {
            noticeCount += 1;
            textWrite(text);
          }
          const pane = id === tileA ? paneA : paneB;
          if (text) pane.textContent = text;
        },
      };
      const specForTile = (tileId: string) => (tileId === tileA ? wifiSpec : heatSpec);

      markPackNavigationStopped(tileA);
      for (let i = 0; i < 600; i++) {
        applyPackNavigationStoppedNotice(mosaic, tileA, specForTile(tileA).name ?? "Pack");
      }
      vi.runAllTimers();
      expect(noticeCount).toBe(1);
      expect(textWrite).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(tileDisplayNameSpy).toHaveBeenCalledTimes(1);

      markPackNavigationStopped(tileB);
      applyPackNavigationStoppedNotice(mosaic, tileB, specForTile(tileB).name ?? "Pack");
      vi.runAllTimers();
      expect(tileDisplayNameSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("shows fail copy with only Remove from wall (no Retry)", () => {
    vi.useFakeTimers();
    const tileId = "plugin:wifi";
    markPackNavigationStopped(tileId);
    const notice = packFeedPaneNotice(tileId, "Wi-Fi");
    expect(notice?.text).toBe(packNavigationStopped("Wi-Fi"));
    expect(notice?.recipe).toBe("fail");
    const mosaic = { setPaneNotice: vi.fn() };
    applyPackNavigationStoppedNotice(mosaic, tileId, "Wi-Fi");
    vi.runAllTimers();
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
