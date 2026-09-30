import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "./settings";
import { hostModeById } from "../app/host-mode";
import { pickMosaicSlot } from "../app/test/duplicate-slot-mosaic-fixture";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
} from "../app/test/duplicate-slot-mosaic-fixture";

const PACK = "plugin:settings-fixture";

describe("settings mosaic pane pick wiring > syncTiles after slot change", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

  it("calls syncTiles once per live mosaic pane pick through onMosaicPanePick", async () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
      compilePlugin({ id: "topology", name: "Topology", packName: "Topology", version: 1, engine: "graph", base: "topology" }),
      compilePlugin({ id: "memory", name: "Memory", packName: "Memory", version: 1, engine: "graph", base: "memory" }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-mosaic-pane-sync-tiles", onChange: () => {} });
    document.body.append(settings.el);
    const { mosaic } = mountDuplicateSlotMosaicHarness(settings, {
      hostModeById,
      pluginSpecForMode: (modeId) => (modeId.startsWith("plugin:settings-fixture") ? spec : null),
      lookForMode: () => null,
      fallbackModeId: () => PACK,
    });
    applyMosaicTiles(settings, mosaic, [PACK, "plugin:topology", "plugin:memory", "plugin:topology"]);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const animUi = (settings as unknown as { animUi: { syncTiles: () => void } | null }).animUi;
    expect(animUi).toBeTruthy();
    let syncCount = 0;
    const origSync = animUi!.syncTiles.bind(animUi);
    animUi!.syncTiles = () => {
      syncCount += 1;
      origSync();
    };
    pickMosaicSlot(settings, 1, "plugin:memory");
    expect(syncCount).toBe(1);
    settings.el.remove();
  });
});
