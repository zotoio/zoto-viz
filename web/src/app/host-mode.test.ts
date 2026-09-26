import { beforeEach, describe, expect, it } from "vitest";
import { modeById, setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { hostModeById } from "./host-mode";

describe("hostModeById > duplicate mosaic slot ids", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("resolves plugin:x!1 to pack x's view and not Topology", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const slotId = "plugin:settings-fixture!1";
    const catalog = modeById(slotId);
    expect(catalog.id).not.toBe(slotId);
    expect(catalog.pluginId ?? catalog.id).not.toBe("topology");
    const mode = hostModeById(slotId);
    expect(mode.id).toBe(slotId);
    expect(mode.pluginId).toBe("settings-fixture");
    expect(mode.label).toBe(spec.name);
  });
});
