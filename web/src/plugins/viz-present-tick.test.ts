import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginSandbox } from "./host";
import { defaultVizContract } from "./viz-host";
import {
  deliverPluginPresentTicks,
  presentTileIds,
  resetPresentTickDeliveryForTests,
} from "./viz-present-tick";

function baseInput(overrides: Partial<Parameters<typeof deliverPluginPresentTicks>[0]> = {}) {
  const sandbox = { present: vi.fn() } as unknown as PluginSandbox;
  return {
    sandbox,
    contract: defaultVizContract({ presentTick: true }),
    frameMs: 16.7,
    pluginClock: 1.25,
    mosaicOn: false,
    tileIds: [] as string[],
    stageTileId: "plugin:demo",
    activePluginId: "demo",
    modeForTile: (id: string) => ({ pluginId: id === "tile-a" || id === "tile-b" ? "demo" : "other" }),
    ...overrides,
  };
}

describe("deliverPluginPresentTicks", () => {
  afterEach(() => {
    resetPresentTickDeliveryForTests();
  });

  it("does not call sandbox.present when presentTick is off", () => {
    const input = baseInput({ contract: defaultVizContract({ presentTick: false }) });
    deliverPluginPresentTicks(input);
    expect(input.sandbox.present).not.toHaveBeenCalled();
  });

  it("delivers exactly one tick per frame for a single-stage view", () => {
    const input = baseInput();
    deliverPluginPresentTicks(input);
    deliverPluginPresentTicks({ ...input, frameMs: 16.7 });
    expect(input.sandbox.present).toHaveBeenCalledTimes(1);
    const tick = (input.sandbox.present as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(tick.frameMs).toBe(16.7);
    expect(tick.tileId).toBe("plugin:demo");
    expect(tick.pluginClock).toBe(1.25);
  });

  it("delivers one tick per mosaic tile that runs the active plugin", () => {
    const tileSeen: string[] = [];
    const sandbox = {
      present: (tick: { tileId: string }) => {
        tileSeen.push(tick.tileId);
      },
    } as unknown as PluginSandbox;
    deliverPluginPresentTicks({
      ...baseInput({ sandbox }),
      mosaicOn: true,
      tileIds: ["tile-a", "tile-b", "tile-c"],
      stageTileId: "tile-a",
      frameMs: 33.4,
    });
    expect(tileSeen).toEqual(["tile-a", "tile-b"]);
  });

});

describe("presentTileIds", () => {
  it("returns no tiles when pack did not opt in", () => {
    const ids = presentTileIds(baseInput({ contract: defaultVizContract() }));
    expect(ids).toEqual([]);
  });
});
