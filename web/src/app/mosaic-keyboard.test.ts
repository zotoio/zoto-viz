import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { viewSelectOptions } from "../plugins/plugin";
import { setPluginModes, talkers, topology } from "../core/modes";
import { modeForDigitKey } from "./header-digit-mode";

describe("header keyboard view shortcuts", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
    ]);
  });
  afterEach(() => setPluginModes([]));

  it("maps number keys to catalog modes like the live keydown handler", () => {
    const modes = viewSelectOptions();
    expect(modes.length).toBe(2);
    expect(modeForDigitKey("1")).toBe("plugin:talkers");
    expect(modeForDigitKey("2")).toBe("plugin:topology");
    expect(modeForDigitKey("0")).toBe(null);
  });
});
