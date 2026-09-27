import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import { hostModeById } from "./host-mode";
import { runMainOnPluginFields } from "./main-on-plugin-fields";

const PACK = "plugin:settings-fixture";

describe("main onPluginFields wiring > mosaic shared config sync", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("calls setMode on every duplicate tile when plugin fields change", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-main-on-plugin-fields", onChange: () => {} });
    settings.openView(`${PACK}!1`);
    const sceneA = { setMode: vi.fn() };
    const sceneB = { setMode: vi.fn() };
    const mosaic = {
      on: true,
      tileIds: [PACK, `${PACK}!1`],
      graphScene: (id: string) => (id === PACK ? sceneA : sceneB),
    };
    const opts = { gain: "9", preset: "a", mode: "x", locked: "0.5" };
    runMainOnPluginFields({
      settings,
      modeSelValue: () => PACK,
      hostModeById,
      optsFor: () => opts,
      mosaic,
      scene: { setMode: vi.fn() },
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      setCurrentOpts: () => {},
      setSkyPrompt: () => {},
      setNestLook: () => {},
      isCarouselMode: () => false,
      onCarouselBind: () => {},
      viewPromptKey: "prompt",
      afterSync: () => {},
    });
    expect(sceneA.setMode).toHaveBeenCalledTimes(1);
    expect(sceneB.setMode).toHaveBeenCalledTimes(1);
    expect(sceneA.setMode.mock.calls[0]![0].id).toBe(PACK);
    expect(sceneB.setMode.mock.calls[0]![0].id).toBe(`${PACK}!1`);
  });
});
