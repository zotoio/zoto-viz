import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedModeOpts, invalidateVizModeOptsCache } from "./main-viz-opts";
import type { ViewMode } from "../core/modes";

describe("main optsFor cache", () => {
  afterEach(() => {
    invalidateVizModeOptsCache();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("W5: 600 cached opts reads → 1 localStorage getItem per plugin field", () => {
    const mode: ViewMode = {
      id: "test-plugin-view",
      label: "Test",
      pluginId: "packet-tunnel",
      options: [],
      config: [{ key: "bright", type: "number", default: 1, min: 0, max: 2 }],
    };
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    getItem.mockClear();
    const build = () => {
      const o: Record<string, string> = {};
      for (const f of mode.config ?? []) {
        const saved = localStorage.getItem(`zoto-viz.plugin.packet-tunnel.${f.key}`);
        o[f.key] = saved ?? "1";
      }
      return o;
    };
    for (let i = 0; i < 600; i++) cachedModeOpts(mode, build);
    expect(getItem).toHaveBeenCalledTimes(1);
  });
});
