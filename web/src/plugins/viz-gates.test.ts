import { describe, expect, it, vi } from "vitest";
import { setVizBuildCostTicksInjector } from "../core/viz-clock";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";
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
  it("fat LAN fixture forces over-budget skip without calling sandbox.frame", () => {
    const fatLan = fatLanFixture();
    expect(fatLan.devices.length).toBeGreaterThanOrEqual(300);
    expect(fatLan.flows.length).toBeGreaterThanOrEqual(1000);

    const sandbox = { frame: vi.fn() };
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["gate"]);
    let mono = 0;
    const budget = new VizFrameBudget(() => mono, "gate");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 1200 : 15000));

    const ok = budget.deliver(fatLan, 0, 0, (f) => sandbox.frame(f), buildVizFrame);
    expect(ok).not.toBeNull();
    expect(sandbox.frame).toHaveBeenCalledTimes(1);

    mono += 17;
    budget.deliver(fatLan, mono, 0, (f) => sandbox.frame(f), buildVizFrame);
    const skipped = budget.deliver(fatLan, mono, 0, (f) => sandbox.frame(f), buildVizFrame);
    setVizBuildCostTicksInjector(undefined);
    expect(skipped).toBeNull();
    expect(budget.stats.skipped).toBe(1);
    expect(sandbox.frame).toHaveBeenCalledTimes(2);
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
