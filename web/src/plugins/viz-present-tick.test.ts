import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSandbox } from "./host";
import { defaultVizContract } from "./viz-host";
import { deliverPluginPresentTick } from "./viz-present-tick";

describe("deliverPluginPresentTick", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("does not call sandbox when presentTick is off", () => {
    const sandbox = new PluginSandbox();
    const spy = vi.spyOn(sandbox, "deliverPresentTick");
    deliverPluginPresentTick(
      {
        sandbox,
        contract: defaultVizContract(),
        tileId: "x",
        pluginClock: () => 0,
        stageAspect: () => 1,
      },
      16,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("delivers exactly one tick per sandbox per frame", async () => {
    const sandbox = new PluginSandbox();
    await sandbox.load(
      "demo",
      "globalThis.ok = true;",
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: true }),
    );
    const iframe = document.querySelector("iframe")!;
    const spy = vi.spyOn(iframe.contentWindow!, "postMessage");
    const binding = {
      sandbox,
      contract: defaultVizContract({ presentTick: true }),
      tileId: "demo",
      pluginClock: () => 3.5,
      stageAspect: () => 1.6,
    };
    deliverPluginPresentTick(binding, 10);
    deliverPluginPresentTick(binding, 10);
    deliverPluginPresentTick(binding, 20);
    const presents = spy.mock.calls.filter((c) => (c[0] as { type?: string }).type === "present");
    expect(presents).toHaveLength(2);
    const last = presents.at(-1)?.[0] as { tick?: { aspect?: number } };
    expect(last?.tick?.aspect).toBe(1.6);
    spy.mockRestore();
    sandbox.unload();
  });
});
