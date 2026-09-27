import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import * as hostViewBind from "./host-view-bind";
import { hostModeById } from "./host-mode";
import { runMainApplyModeDrawerRebind } from "./main-apply-mode-drawer";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
} from "./test/duplicate-slot-mosaic-fixture";

const PACK = "plugin:settings-fixture";

describe("main applyMode drawer wiring > rebind guard", () => {
  let bindThisViewSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    bindThisViewSpy = vi.spyOn(hostViewBind, "bindThisView");
  });

  afterEach(() => {
    bindThisViewSpy.mockRestore();
  });

  it("does not rebuild the drawer when applyMode keeps the same drawer key", async () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
      compilePlugin({ id: "topology", packName: "Topology", version: 1, engine: "graph", base: "topology" }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-main-apply-mode-drawer", onChange: () => {} });
    document.body.append(settings.el);
    const { mosaic, bindThisView } = mountDuplicateSlotMosaicHarness(settings, {
      hostModeById,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      lookForMode: () => null,
      fallbackModeId: () => PACK,
    });
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"]);
    bindThisView(PACK);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    bindThisViewSpy.mockClear();
    runMainApplyModeDrawerRebind(bindThisView, {
      settings,
      modeId: PACK,
      flags: {},
      hostModeById,
    });
    expect(bindThisViewSpy).not.toHaveBeenCalled();
    settings.el.remove();
  });
});
