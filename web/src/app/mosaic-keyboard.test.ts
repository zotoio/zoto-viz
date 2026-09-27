import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { viewSelectOptions } from "../plugins/plugin";
import { setPluginModes, talkers, topology } from "../core/modes";

/** Mirrors the digit shortcut in `main.ts` keydown → applyMode. */
function modeForDigitKey(key: string): string | null {
  const idx = key === "0" ? 9 : Number(key) - 1;
  const modes = viewSelectOptions();
  if (idx >= 0 && idx < modes.length) return modes[idx]!.value;
  return null;
}

describe("header keyboard view shortcuts", () => {
  beforeEach(() => {
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
    ]);
  });
  afterEach(() => setPluginModes([]));

  it("maps number keys to catalog modes like the live keydown handler", () => {
    const modes = viewSelectOptions();
    expect(modes.length).toBeGreaterThan(1);
    expect(modeForDigitKey("1")).toBe(modes[0]!.value);
    expect(modeForDigitKey("2")).toBe(modes[1]!.value);
    expect(modeForDigitKey("0")).toBe(modes[9]?.value ?? null);
  });
});
