import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import { resetPackAssetNavigationState } from "./pack-asset-navigation";
import {
  PluginSandbox,
  resetSandboxFramePostMessageCountForTests,
  sandboxFramePostMessageCountForTests,
} from "./host";
describe("PluginSandbox MessageChannel boot", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue("11111111-1111-4111-8111-111111111111");
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-sandbox");
    resetSandboxFramePostMessageCountForTests();
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
  });

  it("uses exactly one window postMessage to the frame for boot-channel", async () => {
    const box = new PluginSandbox();
    await box.loadModuleUrl(
      `data:text/javascript,${encodeURIComponent("globalThis.ok = true;")}`,
      ["graph.read"],
      {},
    );
    expect(sandboxFramePostMessageCountForTests()).toBe(1);
    box.unload();
  });
});

describe("PluginSandbox navigation teardown", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue("11111111-1111-4111-8111-111111111111");
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-sandbox");
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
    resetPackAssetNavigationState();
  });

  it("tears down iframe and revokes frame on a second load event", async () => {
    const unregister = vi.spyOn(packAssetFrame, "closePackAssetFrameForTile");
    const box = new PluginSandbox();
    box.setActiveTile("plugin:demo");
    box.setActivePackLabel("Demo Pack");
    await box.loadModuleUrl(
      `data:text/javascript,${encodeURIComponent("globalThis.ok = true;")}`,
      ["graph.read"],
      {},
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).toBeTruthy();
    iframe!.dispatchEvent(new Event("load"));
    iframe!.dispatchEvent(new Event("load"));
    await vi.waitFor(() => {
      expect(document.querySelector("iframe")).toBeNull();
    });
    expect(unregister).toHaveBeenCalledWith("plugin:demo", expect.any(String));
    const nav = await import("./pack-asset-navigation");
    expect(nav.packNavigationStoppedForTile("plugin:demo")).toBe(true);
    box.unload();
  });
});
