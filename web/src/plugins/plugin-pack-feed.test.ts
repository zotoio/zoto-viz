import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_PACK_FEED,
  applyPackFeedPaneNotice,
  classifySandboxBootError,
  formatSandboxStartupFailure,
  logSandboxBootFailureOnce,
  markSandboxStartupFailed,
  markSandboxStartupOk,
  noteSandboxFrameTick,
  packFeedPaneNotice,
  redactSandboxTokenInText,
  resetPluginPackFeedState,
  setTileExpectsVizFeed,
} from "./plugin-pack-feed";
import { setPackAssetTokenForTests } from "../core/http";
import { beginActivePackLoad, resetPackAssetFrameState } from "./pack-asset-frame";
import { resetPackAssetNavigationState } from "./pack-asset-navigation";

describe("plugin pack feed notices", () => {
  afterEach(() => {
    resetPluginPackFeedState();
    resetPackAssetFrameState();
    resetPackAssetNavigationState();
  });

  it("shows startup failure copy (not NO PACK FEED) after sandbox boot fails", () => {
    beginActivePackLoad("plugin:blob-mesh", "Blob Mesh");
    markSandboxStartupFailed("plugin:blob-mesh");
    const notice = packFeedPaneNotice("plugin:blob-mesh", "Blob Mesh");
    expect(notice?.text).toBe(formatSandboxStartupFailure("Blob Mesh"));
    expect(notice?.recipe).toBe("fail");
    expect(notice?.text).not.toContain(NO_PACK_FEED);
  });

  it("shows NO PACK FEED when sandbox is live, onFrame ticks, and no viz writes", () => {
    beginActivePackLoad("plugin:talker-storm", "Talker Storm");
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

  it("redacts session token from boot failure console lines", () => {
    setPackAssetTokenForTests("_sandbox", "super-secret-session-token");
    const raw = `Failed to fetch ${location.origin}/pack-assets/super-secret-session-token/demo/module.js`;
    const reason = classifySandboxBootError(new Error(raw));
    expect(reason).not.toContain("super-secret-session-token");
    expect(reason).toContain("<sandbox-token>");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSandboxBootFailureOnce("plugin:demo", reason, "demo");
    expect(warn.mock.calls[0]?.[0]).toMatch(/pack=demo/);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("super-secret-session-token");
    warn.mockRestore();
    setPackAssetTokenForTests("_sandbox", "");
  });

  it("redactSandboxTokenInText handles path segments", () => {
    expect(redactSandboxTokenInText("/pack-assets/abc/pid/x", "abc")).toBe("/pack-assets/<sandbox-token>/pid/x");
  });

  it("applyPackFeedPaneNotice uses fail styling on mosaic tiles", () => {
    const mosaic = { setPaneNotice: vi.fn() };
    beginActivePackLoad("plugin:wifi", "Wi-Fi");
    markSandboxStartupFailed("plugin:wifi");
    applyPackFeedPaneNotice(mosaic, "plugin:wifi", "Wi-Fi");
    expect(mosaic.setPaneNotice).toHaveBeenCalledWith(
      "plugin:wifi",
      formatSandboxStartupFailure("Wi-Fi"),
      "fail",
      expect.objectContaining({ showRetry: false }),
    );
  });
});
