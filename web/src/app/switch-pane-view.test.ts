import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => resetPaneSwitchTokens());

  describe.each([
    ["header", undefined] as const,
    ["tile", "plugin:topology"] as const,
  ])("entry %s", (entry, fromViewId) => {
    it("succeeds through teardown, swap, and mount", async () => {
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:topology",
      });
      const teardownView = vi.fn();
      const mountView = vi.fn();
      const persistLayout = vi.fn();
      const to = entry === "header" ? "plugin:talkers" : "plugin:talkers";
      const result = await switchPaneView(m, to, {
        fromViewId,
        ensureReviewed: async () => true,
        spec: { name: "Talkers" },
        teardownView,
        mountView,
        persistLayout,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.viewId).toBe("plugin:talkers");
      if (entry === "tile") expect(teardownView).toHaveBeenCalled();
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
        fromViewId,
        ensureReviewed: async () => false,
        spec: { name: "Talkers" },
        teardownView: vi.fn(),
        mountView,
        persistLayout: vi.fn(),
      });
      expect(result.ok).toBe(false);
      expect(m.setPaneView).not.toHaveBeenCalled();
      expect(mountView).not.toHaveBeenCalled();
      expect(m.setPaneNotice).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/isn't approved yet.*Settings → Plugins/));
    });

    it("uses focus fallback when the requested tile id is stale", async () => {
      if (entry === "header") return;
      const m = host({
        tileIds: ["plugin:topology", "plugin:wifi"],
        focusedId: "plugin:wifi",
      });
      const resolved = resolvePaneSwitchSlot(m, "plugin:talkers", "plugin:gone");
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.paneId).toBe("plugin:wifi");
    });
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
