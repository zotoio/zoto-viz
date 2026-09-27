/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import {
  HARNESS_PLUGIN_ALT,
  HARNESS_PLUGIN_MODE,
  bootMainEntry,
  pickModeFromUi,
  waitEntryBootComplete,
} from "./main-entry-harness";

describe("main.ts production entry mode picker", () => {
  it("persists the picked view through applyMode on change", async () => {
    expect.hasAssertions();
    await bootMainEntry();
    await waitEntryBootComplete();
    const start = localStorage.getItem("zoto-viz.mode");
    const alt = start === HARNESS_PLUGIN_MODE ? HARNESS_PLUGIN_ALT : HARNESS_PLUGIN_MODE;
    expect(start).toBeTruthy();
    await pickModeFromUi(alt!);
    expect(localStorage.getItem("zoto-viz.mode")).toBe(alt);
  });
});
