import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("plugin consent sync (one page subscription)", () => {
  beforeEach(async () => {
    expect.hasAssertions();
    vi.resetModules();
    vi.useFakeTimers();
    const { clearAllConsentPending } = await import("./consent-pending-panes");
    clearAllConsentPending();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms one shared fallback poll for many waiting tiles", async () => {
    const { initPluginConsentSync, pluginConsentFallbackPollActive, syncPluginConsentPendingState } =
      await import("./plugin-consent-sync");
    const { registerConsentPending } = await import("./consent-pending-panes");
    const refresh = vi.fn(async () => {});
    initPluginConsentSync({ refreshCatalogAndResume: refresh, pollIntervalMs: 10_000 });
    const intervalSpy = vi.spyOn(window, "setInterval");

    registerConsentPending({
      paneId: "plugin:a",
      toViewId: "plugin:heat",
      fromViewId: "plugin:a",
      pluginId: "heat",
    });
    registerConsentPending({
      paneId: "plugin:b",
      toViewId: "plugin:heat",
      fromViewId: "plugin:b",
      pluginId: "heat",
    });
    registerConsentPending({
      paneId: "plugin:c",
      toViewId: "plugin:heat",
      fromViewId: "plugin:c",
      pluginId: "heat",
    });

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(pluginConsentFallbackPollActive()).toBe(true);
    syncPluginConsentPendingState();
    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });

  it("after 10s idle issues one catalog refresh, not one per tile", async () => {
    const { initPluginConsentSync } = await import("./plugin-consent-sync");
    const { registerConsentPending } = await import("./consent-pending-panes");
    let catalogFetches = 0;
    const refresh = vi.fn(async () => {
      catalogFetches += 1;
    });
    initPluginConsentSync({ refreshCatalogAndResume: refresh, pollIntervalMs: 10_000 });

    for (const paneId of ["plugin:t1", "plugin:t2", "plugin:t3"]) {
      registerConsentPending({
        paneId,
        toViewId: "plugin:heat",
        fromViewId: paneId,
        pluginId: "heat",
      });
    }

    await vi.advanceTimersByTimeAsync(10_000);
    expect(catalogFetches).toBe(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(catalogFetches).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops the shared poll when no tiles are waiting", async () => {
    const { initPluginConsentSync, pluginConsentFallbackPollActive } = await import("./plugin-consent-sync");
    const { registerConsentPending, clearAllConsentPending } = await import("./consent-pending-panes");
    const refresh = vi.fn(async () => {});
    initPluginConsentSync({ refreshCatalogAndResume: refresh, pollIntervalMs: 10_000 });
    registerConsentPending({
      paneId: "plugin:a",
      toViewId: "plugin:heat",
      pluginId: "heat",
    });
    expect(pluginConsentFallbackPollActive()).toBe(true);
    clearAllConsentPending();
    expect(pluginConsentFallbackPollActive()).toBe(false);
  });
});
