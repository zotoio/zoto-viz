import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import { hostModeById } from "./host-mode";
import { runMainBindThisView } from "./main-bind-this-view";

const PACK = "plugin:settings-fixture";

describe("main bindThisView wiring > mosaic slot mode id", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("bindView receives the slot mode id for duplicate tiles", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-main-bind-this-view", onChange: () => {} });
    const bindView = vi.spyOn(settings, "bindView");
    const slotId = `${PACK}!1`;
    runMainBindThisView({
      settings,
      hostModeById,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      lookForMode: () => null,
      arcadeControls: () => [],
      paintViewAuth: () => {},
    }, slotId);
    expect(bindView).toHaveBeenCalledTimes(1);
    expect(bindView.mock.calls[0]![4]).toBe(slotId);
  });
});
