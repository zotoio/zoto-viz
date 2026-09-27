import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPaneSwitchTokens,
  resolvePaneSwitchSlot,
  switchPaneView,
  type SwitchPaneViewHost,
} from "./switch-pane-view";

function host(over: Partial<SwitchPaneViewHost> & Pick<SwitchPaneViewHost, "tileIds">): SwitchPaneViewHost {
  return {
    focusedId: null,
    setPaneView: vi.fn(() => true),
    setPaneNotice: vi.fn(),
    focus: vi.fn(),
    ...over,
  };
}

describe("switchPaneView", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => resetPaneSwitchTokens());

  describe("switchPaneViewHeader", () => {
    it("succeeds through teardown, swap, and mount", async () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:topology",
      });
      const teardownView = vi.fn();
      const mountView = vi.fn();
      const persistLayout = vi.fn();
      const result = await switchPaneView(m, "plugin:talkers", {
        ensureReviewed: async () => true,
        spec: { name: "Talkers" },
        teardownView,
        mountView,
        persistLayout,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.viewId).toBe("plugin:talkers");
      expect(m.setPaneView).toHaveBeenCalled();
      expect(mountView).toHaveBeenCalledWith("plugin:talkers");
      expect(persistLayout).toHaveBeenCalled();
    });

    it("denies consent without swapping or mounting", async () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:topology",
      });
      const mountView = vi.fn();
      const result = await switchPaneView(m, "plugin:talkers", {
        ensureReviewed: async () => false,
        spec: { name: "Talkers" },
        teardownView: vi.fn(),
        mountView,
        persistLayout: vi.fn(),
      });
      expect(result.ok).toBe(false);
      expect(m.setPaneView).not.toHaveBeenCalled();
      expect(mountView).not.toHaveBeenCalled();
      expect(m.setPaneNotice.mock.calls.length).toBe(1);
      const call = m.setPaneNotice.mock.calls[0]!;
      expect(call[0]).toBe("plugin:topology");
      expect(call[1]?.includes("\u2192")).toBe(true);
      expect(call[1] === "Not approved yet. Talkers: Approve it in Settings → Plugins.").toBe(true);
    });

    it("uses focus fallback when the requested tile id is stale", () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:wifi",
      });
      const resolved = resolvePaneSwitchSlot(m, "plugin:talkers", undefined);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.paneId).toBe("plugin:wifi");
    });
  });

  describe("switchPaneViewTile", () => {
    it("succeeds through teardown, swap, and mount", async () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:topology",
      });
      const teardownView = vi.fn();
      const mountView = vi.fn();
      const persistLayout = vi.fn();
      const result = await switchPaneView(m, "plugin:talkers", {
        fromViewId: "plugin:topology",
        ensureReviewed: async () => true,
        spec: { name: "Talkers" },
        teardownView,
        mountView,
        persistLayout,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.viewId).toBe("plugin:talkers");
      expect(teardownView).toHaveBeenCalled();
      expect(m.setPaneView).toHaveBeenCalled();
      expect(mountView).toHaveBeenCalledWith("plugin:talkers");
      expect(persistLayout).toHaveBeenCalled();
    });

    it("denies consent without swapping or mounting", async () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:topology",
      });
      const mountView = vi.fn();
      const result = await switchPaneView(m, "plugin:talkers", {
        fromViewId: "plugin:topology",
        ensureReviewed: async () => false,
        spec: { name: "Talkers" },
        teardownView: vi.fn(),
        mountView,
        persistLayout: vi.fn(),
      });
      expect(result.ok).toBe(false);
      expect(m.setPaneView).not.toHaveBeenCalled();
      expect(mountView).not.toHaveBeenCalled();
      expect(m.setPaneNotice.mock.calls.length).toBe(1);
      const call = m.setPaneNotice.mock.calls[0]!;
      expect(call[0]).toBe("plugin:topology");
      expect(call[1]?.includes("\u2192")).toBe(true);
      expect(call[1] === "Not approved yet. Talkers: Approve it in Settings → Plugins.").toBe(true);
    });

    it("uses focus fallback when the requested tile id is stale", () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:wifi",
      });
      const resolved = resolvePaneSwitchSlot(m, "plugin:talkers", "plugin:gone");
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.paneId).toBe("plugin:wifi");
    });
  });

  it("does not teardown the from-view when it remains tiled after a swap", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const teardownView = vi.fn();
    const result = await switchPaneView(m, "plugin:wifi", {
      fromViewId: "plugin:topology",
      ensureReviewed: async () => true,
      spec: { name: "WiFi" },
      teardownView,
      mountView: vi.fn(),
      persistLayout: vi.fn(),
    });
    expect(result.ok).toBe(true);
    expect(teardownView.mock.calls).toHaveLength(0);
  });

  it("applies only the latest rapid double-switch on the same pane", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    let releaseFirst: (() => void) | null = null;
    const mountView = vi.fn();
    const first = switchPaneView(m, "plugin:talkers", {
      fromViewId: "plugin:topology",
      ensureReviewed: () => new Promise<boolean>((resolve) => { releaseFirst = () => resolve(true); }),
      spec: null,
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    const second = switchPaneView(m, "plugin:wifi", {
      fromViewId: "plugin:topology",
      ensureReviewed: async () => true,
      spec: null,
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    releaseFirst!();
    const r1 = await first;
    const r2 = await second;
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    expect(mountView).toHaveBeenLastCalledWith("plugin:wifi");
  });
});
