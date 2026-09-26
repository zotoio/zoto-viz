import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_PACK_FEED,
  applyPackFeedPaneNotice,
  formatSandboxStartupFailure,
  logSandboxBootFailureOnce,
  markSandboxStartupFailed,
  markSandboxStartupOk,
  noteSandboxFrameTick,
  packFeedPaneNotice,
  resetPluginPackFeedState,
  setTileExpectsVizFeed,
} from "./plugin-pack-feed";

describe("plugin pack feed notices", () => {
  afterEach(() => resetPluginPackFeedState());

  it("shows startup failure copy (not NO PACK FEED) after sandbox boot fails", () => {
    markSandboxStartupFailed("plugin:blob-mesh");
    const notice = packFeedPaneNotice("plugin:blob-mesh", "Blob Mesh");
    expect(notice?.text).toBe(formatSandboxStartupFailure("Blob Mesh"));
    expect(notice?.recipe).toBe("fail");
    expect(notice?.text).not.toContain(NO_PACK_FEED);
  });

  it("shows NO PACK FEED when sandbox is live, onFrame ticks, and no viz writes", () => {
    setTileExpectsVizFeed("plugin:talker-storm", true);
    markSandboxStartupOk("plugin:talker-storm");
    noteSandboxFrameTick("plugin:talker-storm");
    noteSandboxFrameTick("plugin:talker-storm");
    const notice = packFeedPaneNotice("plugin:talker-storm", "Talker Storm");
    expect(notice?.text).toBe(NO_PACK_FEED);
    expect(notice?.recipe).toBe("default");
  });

  it("logs sandbox boot failure once per tile", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSandboxBootFailureOnce("plugin:marble-run", "sandbox frame-ready timeout: sandbox frame-ready timeout");
    logSandboxBootFailureOnce("plugin:marble-run", "ignored duplicate");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/sandbox frame-ready timeout/);
    warn.mockRestore();
  });

  it("applyPackFeedPaneNotice uses fail styling on mosaic tiles", () => {
    const mosaic = { setPaneNotice: vi.fn() };
    markSandboxStartupFailed("plugin:wifi");
    applyPackFeedPaneNotice(mosaic, "plugin:wifi", "Wi-Fi");
    expect(mosaic.setPaneNotice).toHaveBeenCalledWith(
      "plugin:wifi",
      formatSandboxStartupFailure("Wi-Fi"),
      "fail",
    );
  });
});
