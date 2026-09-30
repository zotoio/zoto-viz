import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ViewMode } from "../core/modes";
import { VizFrameScopeCache } from "./viz-frame-scope";

const mode: ViewMode = {
  id: "plugin:talker-storm",
  label: "Talker Storm",
  hint: "",
  legend: () => [],
  graphBase: "topology",
  pluginId: "talker-storm",
};

beforeEach(() => {
  expect.hasAssertions();
});

describe("VizFrameScopeCache", () => {
  it("parses source bind once per scope sync, not on 300 frame ticks", () => {
    const parseSourceBind = vi.fn(() => ({ source: "parsed" as const }));
    const illustratedSourceBind = vi.fn(() => ({ source: "illustrated" as const }));
    const syncAdapterViewOpts = vi.fn();
    const optsFor = vi.fn();
    const cache = new VizFrameScopeCache({ parseSourceBind, illustratedSourceBind, syncAdapterViewOpts });

    const opts = { bind: "lan" };
    optsFor();
    cache.sync(mode, opts);
    expect(optsFor).toHaveBeenCalledTimes(1);
    expect(parseSourceBind).toHaveBeenCalledTimes(1);
    expect(illustratedSourceBind).toHaveBeenCalledTimes(0);

    for (let i = 0; i < 300; i++) cache.readBindForFrameTick();

    expect(optsFor).toHaveBeenCalledTimes(1);
    expect(parseSourceBind).toHaveBeenCalledTimes(1);

    const opts2 = { bind: "wan" };
    optsFor();
    cache.sync(mode, opts2);
    expect(optsFor).toHaveBeenCalledTimes(2);
    expect(parseSourceBind).toHaveBeenCalledTimes(2);
  });
});
