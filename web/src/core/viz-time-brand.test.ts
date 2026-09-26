import { describe, expect, it } from "vitest";
import { epochSec, monoMs, wallMs } from "./viz-time";
import { buildVizFrame } from "../plugins/viz-host";
import { vizWallMs } from "./viz-clock";
import type { StateMsg } from "./types";

function emptyState(): StateMsg {
  return {
    ts: 1_700_000_000,
    stats: { active_flows: 0, devices: 0, packets: 0 },
    devices: [],
    flows: [],
    sources: [],
    plugin_state: {},
  };
}

describe("viz time brands", () => {
  it("rejects wall epoch and wall ms where MonoMs is required", () => {
    const state = emptyState();
    const frameT = 1_700_000_000;
    // @ts-expect-error frame.t is EpochSec/plain, not MonoMs
    buildVizFrame(state, frameT, 0);
    // @ts-expect-error vizWallMs is wall clock, not monotonic MonoMs
    buildVizFrame(state, vizWallMs(), 0);
    expect(buildVizFrame(state, monoMs(0), 0).dt).toBe(0);
  });
});
