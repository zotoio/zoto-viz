import { describe, beforeEach, expect, it } from "vitest";
import { epochSec, monoMs, wallMs } from "./viz-time";
import { buildVizFrame } from "../plugins/viz-host";
import { vizWallMs } from "./viz-clock";
import type { StateMsg } from "./types";

function emptyState(): StateMsg {
  return {
    type: "state",
    ts: 1_700_000_000,
    iface: "",
    interfaces: [],
    network: "",
    local_ip: "",
    gateway: "",
    uptime: 0,
    stats: { pps: 0, bps: 0, packets: 0, bytes: 0, devices: 0, online: 0, flows: 0, active_flows: 0 },
    devices: [],
    flows: [],
    sources: {},
    plugin_state: {},
  };
}

describe("viz time brands", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

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
