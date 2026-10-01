import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import { PluginSandbox, setPluginModuleSandboxUrlForTests } from "./host";
import { bindVizDriveElement, noteSandboxWrite, resetVizDriveState, vizDriveFor } from "./viz-drive";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";

/**
 * #233 (TSE): with a sandbox per mosaic pane, unloading one sandbox must not act for the others.
 * The global sandbox-ready flag stays true while another sandbox is ready (only the unloaded
 * tile's write flag clears), and the tile scope stays put while another sandbox is live. The last
 * unload clears ready and resets the scope to ["main"], which is what the one sandbox did before #233.
 * Revert: drop the readySandboxes.size check in PluginSandbox.dropReady -> this row goes red.
 */

const TILE_A = "backrooms";
const TILE_B = "backrooms!2";

describe("#233 two ready sandboxes, then unload one", () => {
  let packAssetFrame: typeof import("./pack-asset-frame");
  let opened = 0;
  const made: PluginSandbox[] = [];

  beforeEach(async () => {
    packAssetFrame = await import("./pack-asset-frame");
    opened = 0;
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => {
      opened += 1;
      return `${String(opened).padStart(8, "0")}-cccc-4ccc-8ccc-cccccccccccc`;
    });
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
    resetVizDriveState();
    vizTileBudgetRegistry.reset();
  });

  afterEach(() => {
    // Unload every sandbox the row made, so the host's live / ready sets never leak into the next row.
    for (const sb of made.splice(0)) sb.unload();
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    document.querySelectorAll("[data-viz-drive]").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
    resetVizDriveState();
    vizTileBudgetRegistry.reset();
  });

  function tileEl(tileId: string): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    bindVizDriveElement(tileId, el);
    return el;
  }

  async function bootFor(tileId: string): Promise<PluginSandbox> {
    const sb = new PluginSandbox();
    made.push(sb);
    sb.setActiveTile(tileId);
    await sb.loadModule("backrooms", ["viz.read", "viz.write"], {}, `h-${tileId}`);
    expect(sb.readyPack, `${tileId}'s sandbox sent ready`).toBe("backrooms");
    return sb;
  }

  it("keeps ready and the tile scope while another sandbox is ready, and clears both with the last", async () => {
    const elA = tileEl(TILE_A);
    const elB = tileEl(TILE_B);
    tileEl("probe");
    tileEl("probe-after-last");
    // The happy-dom handshake boots one iframe at a time.
    const a = await bootFor(TILE_A);
    const b = await bootFor(TILE_B);
    expect(a.liveFrame === b.liveFrame, "the two tiles share one iframe").toBe(false);
    syncVizTileScope(["main", TILE_A, TILE_B]);
    noteSandboxWrite(TILE_A);
    noteSandboxWrite(TILE_B);
    expect(vizDriveFor(TILE_A), "A's drive with both ready").toBe("sandbox");
    expect(vizDriveFor(TILE_B), "B's drive with both ready").toBe("sandbox");
    expect(vizTileBudgetRegistry.activeTileCount(), "tiles in scope with both live").toBe(3);

    a.unload();
    expect(vizDriveFor(TILE_A), "A's drive after A unloads").toBe("none");
    expect(elA.dataset.vizDrive, "A's data-viz-drive after A unloads").toBe("none");
    expect(vizDriveFor(TILE_B), "B's drive after A unloads").toBe("sandbox");
    expect(elB.dataset.vizDrive, "B's data-viz-drive after A unloads").toBe("sandbox");
    noteSandboxWrite("probe"); // a write lands as "sandbox" only while the global ready flag is up
    expect(vizDriveFor("probe"), "global sandbox ready after A unloads (B still ready)").toBe("sandbox");
    expect(vizTileBudgetRegistry.activeTileCount(), "tiles in scope after A unloads (B still live)").toBe(3);

    b.unload();
    expect(vizDriveFor(TILE_B), "B's drive after the last unload").toBe("none");
    expect(vizDriveFor("probe"), "the probe tile's drive after the last unload").toBe("none");
    noteSandboxWrite("probe-after-last");
    expect(vizDriveFor("probe-after-last"), "global sandbox ready after the last unload").toBe("none");
    expect(vizTileBudgetRegistry.activeTileCount(), "tiles in scope after the last unload (scope [\"main\"])").toBe(1);
  });
});
