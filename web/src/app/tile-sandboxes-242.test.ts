import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import { loadShippedPackSpec } from "../plugins/fixtures/host-idle-shipped-packs";
import { PluginSandbox, setPluginModuleSandboxUrlForTests } from "../plugins/host";
import * as packAssetFrame from "../plugins/pack-asset-frame";
import type { PluginView } from "../plugins/plugin";
import { bindVizDriveElement, noteSandboxWrite, resetVizDriveState, vizDriveFor } from "../plugins/viz-drive";
import { attachPaneSandbox, TileSandboxes } from "./tile-sandboxes";

/**
 * #242 (follow-up to #233), on real PluginSandboxes and main.ts's own pane attach (attachPaneSandbox).
 * N4: a restarted pane's old attach that settles late must not clear the new sandbox's drive.
 * Revert: the dropReady guard (host.ts).
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BACKROOMS: PluginView = { ...loadShippedPackSpec(REPO, "backrooms"), hash: "h-backrooms", has_frontend: true };
const PANE = BACKROOMS.id;
const DRIVEN = "topology";

describe("#242 pane sandboxes: restart and drop stop the old attach", () => {
  const made: PluginSandbox[] = [];
  let opened = 0;

  beforeEach(() => {
    opened = 0;
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => {
      opened += 1;
      return `${String(opened).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
    });
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
    resetVizDriveState();
  });

  afterEach(() => {
    for (const sb of made.splice(0)) sb.unload();
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
    resetVizDriveState();
  });

  function paneTiles(): TileSandboxes<PluginSandbox> {
    const box = (): PluginSandbox => {
      const sb = new PluginSandbox();
      made.push(sb);
      return sb;
    };
    return new TileSandboxes<PluginSandbox>({
      main: box(),
      create: box,
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: (sb, spec, tileId, config, signal) => attachPaneSandbox(sb, spec, tileId, config, signal, null),
    });
  }

  /** Bounded below the test timeout, so a pane that never boots fails here, not as a timeout. */
  async function untilReady(tiles: TileSandboxes<PluginSandbox>): Promise<void> {
    await vi.waitFor(() => {
      expect(tiles.readyPackFor(PANE), "the restarted pane boots its pack").toBe(BACKROOMS.id);
    }, { timeout: 3_000 });
  }

  it("(N4) a restarted pane's old attach settling late leaves the new sandbox's drive at sandbox", async () => {
    bindVizDriveElement(PANE, document.createElement("div"));
    let inOpen = false;
    let release = (): void => {};
    // The old attach's frame request cannot be cancelled: it answers after the restart is ready.
    vi.mocked(packAssetFrame.openPackAssetFrame).mockImplementationOnce(() => new Promise<string>((resolve) => {
      inOpen = true;
      release = () => resolve("ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    }));
    const tiles = paneTiles();
    const first = tiles.load(PANE, BACKROOMS);
    const old = tiles.sandboxFor(PANE);
    await vi.waitFor(() => { expect(inOpen, "the old attach waits on its frame request").toBe(true); });
    await tiles.restart(PANE);
    await untilReady(tiles);
    const fresh = tiles.sandboxFor(PANE);
    expect(fresh, "the restart made a new sandbox").not.toBe(old);
    noteSandboxWrite(PANE); // the new sandbox writes (host.ts notes every write for its tile)
    expect(vizDriveFor(PANE), "drive once the new sandbox wrote").toBe("sandbox");
    release();
    await first; // the old attach settles: its late unload (and the backstop) run now
    expect.soft(vizDriveFor(PANE), "the restarted pane's drive after the old attach settles late").toBe("sandbox");
    expect.soft(fresh.readyPack, "the new sandbox stays ready").toBe(BACKROOMS.id);
  });
});
