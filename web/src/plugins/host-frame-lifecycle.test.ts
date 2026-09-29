import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import { PluginSandbox, setPluginModuleSandboxUrlForTests } from "./host";

const FRAME_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FRAME_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("PluginSandbox frame lifecycle", () => {
  let open: ReturnType<typeof vi.spyOn>;
  let close: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const ids = [FRAME_A, FRAME_B];
    open = vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => ids.shift() ?? FRAME_B);
    close = vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
  });

  it("one frame per pick: a repeat of the same load while booting joins it", async () => {
    const box = new PluginSandbox();
    const a = box.loadModule("koi-pond", ["viz.write"], {}, "h1");
    const b = box.loadModule("koi-pond", ["viz.write"], {}, "h1");
    await Promise.all([a, b]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(box.readyPack).toBe("koi-pond");
    box.unload();
  });

  it("marks the pack ready only after boot, and clears it on unload", async () => {
    const box = new PluginSandbox();
    const p = box.loadModule("koi-pond", ["viz.write"], {}, "h1");
    expect(box.readyPack).toBe("");
    await p;
    expect(box.readyPack).toBe("koi-pond");
    expect(packAssetFrame.isSandboxOwnedFrame(FRAME_A)).toBe(true);
    box.unload();
    expect(box.readyPack).toBe("");
    expect(packAssetFrame.isSandboxOwnedFrame(FRAME_A)).toBe(false);
  });

  it("unload closes its own frame id, not whatever the tile holds", async () => {
    const box = new PluginSandbox();
    await box.loadModule("koi-pond", ["viz.write"], {}, "h1");
    box.unload();
    expect(close).toHaveBeenCalledWith("main", FRAME_A);
  });

  it("a different pick still replaces the frame", async () => {
    const box = new PluginSandbox();
    await box.loadModule("voxel-world", ["viz.write"], {}, "h0");
    await box.loadModule("koi-pond", ["viz.write"], {}, "h1");
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith("main", FRAME_A);
    expect(box.readyPack).toBe("koi-pond");
    box.unload();
  });
});
