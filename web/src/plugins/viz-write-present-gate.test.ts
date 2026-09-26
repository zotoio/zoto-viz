import { describe, expect, it, vi } from "vitest";
import { PluginSandbox } from "./host";
import { defaultVizContract } from "./viz-host";
import { deliverPluginPresentTick } from "./viz-present-tick";

describe("viz.write without presentTick", () => {
  it("receives no present ticks and no host slot writes from the present path", async () => {
    const sandbox = new PluginSandbox();
    const hostWrites: number[] = [];
    sandbox.handlers = {
      writeBuffer: (slot) => {
        hostWrites.push(slot);
      },
    };
    await sandbox.load(
      "demo-pack",
      "globalThis.ok = true;",
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: false }),
    );
    const deliverSpy = vi.spyOn(sandbox, "deliverPresentTick");
    const binding = {
      sandbox,
      contract: defaultVizContract({ presentTick: false }),
      tileId: "plugin:demo-pack",
      pluginClock: () => 1,
      stageAspect: () => 16 / 9,
    };
    deliverPluginPresentTick(binding, 16.7);
    deliverPluginPresentTick(binding, 33.4);
    expect(deliverSpy).not.toHaveBeenCalled();
    expect(hostWrites).toEqual([]);
    deliverSpy.mockRestore();
    sandbox.unload();
  });
});
