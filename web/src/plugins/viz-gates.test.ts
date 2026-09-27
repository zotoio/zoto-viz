import { beforeEach, describe, expect, it, vi } from "vitest";
import { monoMs } from "../core/viz-time";
import { toPluginView } from "./plugin-visualisation";
import {
  VIZ_FRAME_BUDGET_MS,
  VizBufferWriter,
  VizFrameBudget,
  buildVizFrame,
  parseVizContract,
} from "./viz-host";
import { fatLanFixture } from "./fixtures/fat-lan-state";

describe("viz merge gates", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("fat LAN fixture forces over-budget skip without calling sandbox.frame", () => {
    const fatLan = fatLanFixture();
    expect(fatLan.devices.length).toBeGreaterThanOrEqual(300);
    expect(fatLan.flows.length).toBeGreaterThanOrEqual(1000);

    const sandbox = { frame: vi.fn() };
    const times = [0, 5, 0, VIZ_FRAME_BUDGET_MS + 3];
    let tick = 0;
    const budget = new VizFrameBudget(() => times[tick++] ?? 999);

    const ok = budget.deliver(fatLan, monoMs(0), 0, (f) => sandbox.frame(f), buildVizFrame);
    expect(ok).not.toBeNull();
    expect(sandbox.frame).toHaveBeenCalledTimes(1);

    const skipped = budget.deliver(fatLan, monoMs(ok!.t), 0, (f) => sandbox.frame(f), buildVizFrame);
    expect(skipped).toBeNull();
    expect(budget.stats.overBudget).toBe(1);
    expect(budget.stats.skipped).toBe(1);
    expect(sandbox.frame).toHaveBeenCalledTimes(1);
  });

  it("talker-storm refuses more than 512 particles", () => {
    // mirrors plugins/src/talker-storm/plugin.yml viz block
    const contract = parseVizContract({
      graphWalk: false,
      idle: { fixture: "host" },
      maxBuffers: 1,
      maxBufferFloats: 8,
      maxParticles: 512,
    });
    expect(contract?.maxParticles).toBe(512);

    const writer = new VizBufferWriter(contract!);
    const over = writer.writeParticles(new Float32Array(513 * 4).fill(0.5), 4);
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/512/);

    const atCap = writer.writeParticles(new Float32Array(512 * 4).fill(0.5), 4);
    expect(atCap.ok).toBe(true);
    expect(atCap.written).toBe(512);
  });

  it("viz pack declaring graphWalk true fails host parse", () => {
    expect(parseVizContract({ graphWalk: true, maxParticles: 0 })).toBeUndefined();
    const view = toPluginView({
      id: "bad-walk",
      name: "Bad Walk",
      version: 1,
      capabilities: ["viz.read", "viz.write"],
      viz: { graphWalk: true, maxParticles: 0, idle: { fixture: "host" } },
    });
    expect(view.viz).toBeUndefined();
  });
});
