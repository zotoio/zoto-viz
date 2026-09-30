import { describe, expect, it, beforeEach } from "vitest";
import type { ViewMode } from "../core/modes";
import { illustratedSourceBind, parseSourceBind } from "../core/sources";
import { VizFrameScopeCache } from "./viz-frame-scope";
import { vizFrameHostPerFrameTick } from "./viz-frame-host-tick";
import type { VizDataFrame } from "../plugins/viz-host";
import { applyVizFrameContractV2, resolveVizFrameCollectOpts } from "../plugins/viz-frame-collect";
import type { Device, Flow, StateMsg } from "../core/types";
import { emptyMonitorState } from "../plugins/fixtures/viz-sdk-frame-build";
import { mockPartial } from "../../test-support/mock-partial";

const mode: ViewMode = {
  id: "topology",
  label: "Topology",
  hint: "topology",
  graphBase: "topology",
  legend: () => [],
};

beforeEach(() => {
  expect.hasAssertions();
});

describe("viz frame hot path steady-state", () => {
  it("reuses the host per-frame tick input object over 600 ticks (0 new tick inputs)", () => {
    const scope = new VizFrameScopeCache({
      parseSourceBind,
      illustratedSourceBind,
      syncAdapterViewOpts: () => {},
    });
    scope.sync(mode, { source: "lan" });
    const tickInput = { mode, currentOpts: { source: "lan" }, scope };
    const held = tickInput;
    for (let i = 0; i < 600; i++) vizFrameHostPerFrameTick(tickInput);
    expect(tickInput).toBe(held);
  });

  it("reuses contract v2 link scratch buffers over 600 identical enrich passes (0 link array allocations)", () => {
    const state: StateMsg = {
      ...emptyMonitorState(1),
      devices: [mockPartial<Device>({ ip: "10.0.0.1", packets: 1, role: "lan" })],
      flows: [mockPartial<Flow>({ a: "10.0.0.1", b: "10.0.0.2", packets: 1, bytes: 1, rate_pkt_ab: 3 })],
      sources: {},
      host: { vizFrame: { links: true, linksMax: 8 } },
    };
    const frame: VizDataFrame = {
      contract: 1,
      t: 1,
      dt: 0,
      audio: 0,
      packets: [],
      rf: [],
      talkers: [{ id: "10.0.0.1", rate: 1, role: "lan" }],
      headlines: [],
    };
    const opts = resolveVizFrameCollectOpts(state);
    let linksRef: VizDataFrame["links"];
    for (let i = 0; i < 600; i++) {
      applyVizFrameContractV2(frame, state, opts);
      if (!linksRef) linksRef = frame.links;
      else expect(frame.links).toBe(linksRef);
    }
    expect(frame.links).toEqual([]);
  });
});
