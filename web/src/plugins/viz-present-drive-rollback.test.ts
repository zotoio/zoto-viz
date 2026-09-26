import { describe, expect, it, vi } from "vitest";
import { PluginSandbox } from "./host";
import { defaultVizContract } from "./viz-host";
import { presentDriveBindingForPlugin, presentTickTileId } from "./viz-present-tick";

describe("present drive rollback", () => {
  it("restores the prior pack tile id after a declined mode switch", () => {
    const sandbox = new PluginSandbox();
    const backrooms = { id: "backrooms", viz: defaultVizContract({ presentTick: true }) };
    const stereo = { id: "stereo-gram", viz: defaultVizContract({ presentTick: true }) };
    const before = presentDriveBindingForPlugin(sandbox, backrooms, () => 0, () => 16 / 9);
    expect(presentTickTileId(before?.tileId)).toBe("backrooms");
    const during = presentDriveBindingForPlugin(sandbox, stereo, () => 0, () => 16 / 9);
    expect(during?.tileId).toBe("stereo-gram");
    const restored = before;
    expect(restored?.tileId).toBe("backrooms");
    vi.restoreAllMocks();
  });
});
