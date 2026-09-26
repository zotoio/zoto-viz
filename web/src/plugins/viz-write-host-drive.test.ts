import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginView } from "./plugin";
import { defaultVizContract } from "./viz-host";
import { PluginSandbox } from "./host";
import {
  clearLegacyVizWriteDrivesForTests,
  registerLegacyVizWriteDrive,
  runLegacyVizWriteDrive,
} from "./viz-write-host-drive";
import { deliverPluginPresentTick } from "./viz-present-tick";

function mockSpec(presentTick: boolean): PluginView {
  return {
    id: "mock-pack",
    name: "Mock",
    version: 1,
    capabilities: ["viz.write"],
    viz: defaultVizContract({ presentTick }),
  };
}

describe("viz.write host drive vs presentTick", () => {
  afterEach(() => {
    clearLegacyVizWriteDrivesForTests();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("runs legacy drive when presentTick is false", () => {
    const legacy = vi.fn();
    registerLegacyVizWriteDrive("mock-pack", legacy);
    const writer = { writeBuffer: vi.fn(), ubo: new Float32Array(8) };
    const ok = runLegacyVizWriteDrive(mockSpec(false), {
      skyTime: () => 1,
      aspect: () => 16 / 9,
      writer: writer as never,
      syncUbo: () => {},
    });
    expect(ok).toBe(true);
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it("skips legacy drive when presentTick is true", () => {
    const legacy = vi.fn();
    registerLegacyVizWriteDrive("mock-pack", legacy);
    const ok = runLegacyVizWriteDrive(mockSpec(true), {
      skyTime: () => 1,
      aspect: () => 16 / 9,
      writer: { writeBuffer: vi.fn() } as never,
      syncUbo: () => {},
    });
    expect(ok).toBe(false);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("opted-in pack receives onPresent only", async () => {
    const legacy = vi.fn();
    registerLegacyVizWriteDrive("mock-pack", legacy);
    const sandbox = new PluginSandbox();
    await sandbox.load(
      "mock-pack",
      `globalThis.seen = [];
zoto.onPresent = (tick) => { globalThis.seen.push(tick.pluginClock ?? -1); };`,
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: true }),
    );
    const deliverSpy = vi.spyOn(sandbox, "deliverPresentTick");
    deliverPluginPresentTick(
      {
        sandbox,
        contract: defaultVizContract({ presentTick: true }),
        tileId: "plugin:mock-pack",
        pluginClock: () => 9.25,
      },
      33,
    );
    expect(deliverSpy).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
    deliverSpy.mockRestore();
    sandbox.unload();
  });
});
