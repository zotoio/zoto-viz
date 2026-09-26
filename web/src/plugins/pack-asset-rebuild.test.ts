import { afterEach, describe, expect, it, vi } from "vitest";
import { PackAssetForbiddenError } from "../core/http";
import { SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";
import {
  consumeServerRestartWallNotice,
  resetPackAssetFrameState,
  scheduleServerRestartWallNotice,
} from "./pack-asset-frame";
import { runPackAssetProtectedLoad } from "./pack-asset-rebuild";
import { markSandboxStartupOk, resetPluginPackFeedState, setTileExpectsVizFeed } from "./plugin-pack-feed";

describe("pack asset rebuild on 403", () => {
  afterEach(() => {
    resetPackAssetFrameState();
    resetPluginPackFeedState();
  });

  it("rebuilds the frame path and keeps reconnecting copy before success", async () => {
    const mosaic = {
      setPaneNotice: vi.fn(),
      setWallNotice: vi.fn(),
    };
    setTileExpectsVizFeed("plugin:wifi", true);
    markSandboxStartupOk("plugin:wifi");
    let calls = 0;
    await runPackAssetProtectedLoad("plugin:wifi", "Wi-Fi", mosaic, async () => {
      calls += 1;
      if (calls === 1) throw new PackAssetForbiddenError("wifi");
    });
    expect(calls).toBe(2);
    expect(mosaic.setPaneNotice).toHaveBeenCalled();
    const texts = mosaic.setPaneNotice.mock.calls.map((c) => c[1]);
    expect(texts.some((t) => typeof t === "string" && t.includes("Reconnecting"))).toBe(true);
  });

  it("does not leave the tile without a notice after a failed rebuild", async () => {
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    setTileExpectsVizFeed("plugin:wifi", true);
    markSandboxStartupOk("plugin:wifi");
    await expect(
      runPackAssetProtectedLoad("plugin:wifi", "Wi-Fi", mosaic, async () => {
        throw new PackAssetForbiddenError("wifi");
      }),
    ).rejects.toBeInstanceOf(PackAssetForbiddenError);
    const last = mosaic.setPaneNotice.mock.calls.at(-1);
    expect(String(last?.[1])).toMatch(/couldn't start/i);
  });
});

describe("server restart wall notice", () => {
  afterEach(() => resetPackAssetFrameState());

  it("emits exactly one wall notice for a coordinated restart", () => {
    scheduleServerRestartWallNotice();
    scheduleServerRestartWallNotice();
    expect(consumeServerRestartWallNotice()).toBe(SERVER_RESTART_WALL_NOTICE);
    expect(consumeServerRestartWallNotice()).toBeNull();
  });
});
