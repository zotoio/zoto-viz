import { describe, expect, it, vi } from "vitest";
import * as sources from "../core/sources";
import type { ViewMode } from "../core/modes";
import * as modeOpts from "./mode-opts";
import { optsForMode } from "./mode-opts";
import { VizFrameScopeCache } from "./viz-frame-scope";
import { vizFrameHostPerFrameTick, vizFrameHostScopeSync } from "./viz-frame-host-tick";

const mode: ViewMode = {
  id: "topology",
  label: "Topology",
  hint: "topology",
  graphBase: "topology",
  legend: () => [],
};

describe("vizFrameHostPerFrameTick", () => {
  it("uses scope-synced bind for 300 frame ticks without extra optsFor or parseSourceBind", () => {
    const parseSourceBind = vi.spyOn(sources, "parseSourceBind");
    const optsSpy = vi.spyOn(modeOpts, "optsForMode");
    const optsFor = (m: ViewMode) => optsForMode(m, () => null);

    const scope = new VizFrameScopeCache({
      parseSourceBind: sources.parseSourceBind,
      illustratedSourceBind: sources.illustratedSourceBind,
      syncAdapterViewOpts: () => {},
    });

    let currentOpts = vizFrameHostScopeSync(mode, scope, optsFor);
    expect(optsSpy).toHaveBeenCalledTimes(1);
    expect(parseSourceBind).toHaveBeenCalledTimes(1);

    const tick = () => {
      vizFrameHostPerFrameTick({ mode, currentOpts, scope, optsFor });
    };
    tick(); // frame 0
    for (let i = 0; i < 300; i++) tick();

    expect(optsSpy).toHaveBeenCalledTimes(1);
    expect(parseSourceBind).toHaveBeenCalledTimes(1);

    currentOpts = vizFrameHostScopeSync(mode, scope, optsFor);
    expect(optsSpy).toHaveBeenCalledTimes(2);
    expect(parseSourceBind).toHaveBeenCalledTimes(2);
  });
});
