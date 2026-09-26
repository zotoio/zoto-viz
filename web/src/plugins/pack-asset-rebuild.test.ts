import { afterEach, describe, expect, it, vi } from "vitest";
import { PackAssetForbiddenError, PackAssetTokenInvalidError } from "../core/http";
import { SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";
import {
  consumeServerRestartWallNotice,
  openPackAssetFrame,
  packAssetFrameOpenCount,
  resetPackAssetFrameState,
  scheduleServerRestartWallNotice,
  tileRebuildAttemptCount,
} from "./pack-asset-frame";
import { runPackAssetProtectedLoad } from "./pack-asset-rebuild";
import { markSandboxStartupOk, resetPluginPackFeedState, setTileExpectsVizFeed } from "./plugin-pack-feed";

describe("pack asset rebuild on token_invalid", () => {
  afterEach(() => {
    resetPackAssetFrameState();
    resetPluginPackFeedState();
    vi.useRealTimers();
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
      if (calls === 1) throw new PackAssetTokenInvalidError("wifi");
    });
    expect(calls).toBe(2);
    expect(mosaic.setPaneNotice).toHaveBeenCalled();
    const texts = mosaic.setPaneNotice.mock.calls.map((c) => c[1]);
    expect(texts.some((t) => typeof t === "string" && t.includes("Reconnecting"))).toBe(true);
  });

  it("does not rebuild on pack path 403 (dotfile) and keeps frame count stable", async () => {
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    await expect(
      runPackAssetProtectedLoad("plugin:dot", "Dot", mosaic, async () => {
        await openPackAssetFrame("plugin:dot");
        for (let i = 0; i < 600; i += 1) {
          throw new PackAssetForbiddenError("dot");
        }
      }),
    ).rejects.toBeInstanceOf(PackAssetForbiddenError);
    expect(packAssetFrameOpenCount("plugin:dot")).toBe(1);
    expect(tileRebuildAttemptCount("plugin:dot")).toBe(0);
  });

  it("does not leave the tile without a notice after a failed rebuild", async () => {
    vi.useFakeTimers();
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    setTileExpectsVizFeed("plugin:wifi", true);
    markSandboxStartupOk("plugin:wifi");
    const p = runPackAssetProtectedLoad("plugin:wifi", "Wi-Fi", mosaic, async () => {
      throw new PackAssetTokenInvalidError("wifi");
    });
    const settled = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    await expect(settled).resolves.toBeInstanceOf(PackAssetTokenInvalidError);
    const last = mosaic.setPaneNotice.mock.calls.at(-1);
    expect(String(last?.[1])).toMatch(/couldn't start/i);
    expect(tileRebuildAttemptCount("plugin:wifi")).toBe(3);
  });

  it("backs off at 1s, 2s, then 4s across three rebuild attempts", async () => {
    vi.useFakeTimers();
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    const delays: number[] = [];
    let last = 0;
    const stamp = () => {
      const now = Date.now();
      if (last) delays.push(now - last);
      last = now;
    };
    let calls = 0;
    const p = runPackAssetProtectedLoad("plugin:wifi", "Wi-Fi", mosaic, async () => {
      stamp();
      calls += 1;
      throw new PackAssetTokenInvalidError("wifi");
    });
    const settled = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    await expect(settled).resolves.toBeInstanceOf(PackAssetTokenInvalidError);
    expect(calls).toBe(4);
    expect(delays.slice(0, 3)).toEqual([1000, 2000, 4000]);
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
