import { describe, expect, it, vi } from "vitest";
import { PluginSandbox } from "./host";
import { defaultVizContract } from "./viz-host";

describe("plugin SDK present dispatch", () => {
  it("forwards present ticks to zoto.onPresent", async () => {
    const box = new PluginSandbox();
    await box.load(
      "demo",
      `zoto.onPresent = (tick) => { globalThis.__tick = tick; };`,
      ["viz.write"],
      {},
      defaultVizContract({ presentTick: true }),
    );
    const port = (box as unknown as { hostPort: MessagePort }).hostPort;
    const spy = vi.spyOn(port, "postMessage");
    box.deliverPresentTick(55, "plugin:demo", 2.5);
    const present = spy.mock.calls.find((c) => (c[0] as { type?: string }).type === "present")?.[0] as {
      tick?: { frameMs: number; pluginClock?: number };
    };
    expect(present?.tick?.frameMs).toBe(55);
    expect(present?.tick?.pluginClock).toBe(2.5);
    spy.mockRestore();
    box.unload();
  });
});
