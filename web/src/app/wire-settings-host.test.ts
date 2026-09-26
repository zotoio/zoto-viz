import { describe, expect, it } from "vitest";
import { setPluginModes, modeById } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { hostModeById } from "./host-mode";
import { resolveMosaicTileHudRow } from "./wire-settings-host";

describe("wire-settings-host > resolveMosaicTileHudRow", () => {
  it("loads pack spec via parseMosaicSlotId for duplicate tile ids", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const slotId = "plugin:settings-fixture!1";
    expect(modeById(slotId).id).not.toBe(slotId);
    expect(hostModeById(slotId).id).toBe(slotId);
    const row = resolveMosaicTileHudRow(slotId, {
      modeById: hostModeById,
      pluginSpecForMode: (viewId) => (viewId === "plugin:settings-fixture" ? spec : null),
      optsFor: () => ({ gain: "3" }),
    });
    expect(row?.spec.id).toBe("settings-fixture");
    expect(row?.mode.id).toBe(slotId);
  });
});
