/**
 * #257: the render governor is on by default. A legacy profile's `vizGovernor: false`
 * was the old default, so it applies as on. A current profile's false stays off.
 * `?vizGovernor=0` and `?vizGovernor=1` still override for one load.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeSettings, shippedSettings, vizGovernorEnabledForSettings } from "../core/profiles";
import {
  loadVizGovernorSetting,
  refreshHostRenderScaleGovernorEnabled,
  resolveVizGovernorEnabled,
  setVizGovernorSetting,
} from "./render-scale-governor-enable";
import { createVizGovernorToggle } from "../app/render-scale-governor-wiring";
import type { RenderScaleGovernorHost } from "../app/render-scale-governor-wiring";

const HELP = "Lowers a view's render resolution when it can't keep up. On by default.";

describe("#257 render governor on by default", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    refreshHostRenderScaleGovernorEnabled("");
  });

  it("(1) empty storage and no query is on", () => {
    expect(localStorage.getItem("zoto-viz.vizGovernor")).toBeNull();
    expect(loadVizGovernorSetting()).toBe(true);
    expect(resolveVizGovernorEnabled("")).toBe(true);
  });

  it("(2) storage 0 is off and storage 1 is on", () => {
    localStorage.setItem("zoto-viz.vizGovernor", "0");
    expect(loadVizGovernorSetting()).toBe(false);
    expect(resolveVizGovernorEnabled("")).toBe(false);
    localStorage.setItem("zoto-viz.vizGovernor", "1");
    expect(loadVizGovernorSetting()).toBe(true);
    expect(resolveVizGovernorEnabled("")).toBe(true);
  });

  it("(3) a legacy false applies as on; a v: 1 false applies as off", () => {
    const legacy = normalizeSettings({ ...shippedSettings(), vizGovernor: false });
    delete (legacy as { v?: number }).v;
    const loaded = normalizeSettings(legacy);
    expect(loaded.legacy).toBe(true);
    expect(loaded.vizGovernor).toBe(false);
    expect(vizGovernorEnabledForSettings(loaded)).toBe(true);
    const chosen = normalizeSettings({ ...shippedSettings(), v: 1, vizGovernor: false });
    expect(chosen.legacy).toBe(false);
    expect(vizGovernorEnabledForSettings(chosen)).toBe(false);
  });

  it("(4) turning it off, then reloading and applying that profile, leaves it off", () => {
    setVizGovernorSetting(false);
    expect(loadVizGovernorSetting()).toBe(false);
    const again = normalizeSettings({ ...shippedSettings(), v: 1, vizGovernor: false });
    expect(vizGovernorEnabledForSettings(again)).toBe(false);
    setVizGovernorSetting(vizGovernorEnabledForSettings(again));
    expect(loadVizGovernorSetting()).toBe(false);
    expect(resolveVizGovernorEnabled("")).toBe(false);
  });

  it("(5) the query overrides the default and a stored off", () => {
    expect(resolveVizGovernorEnabled("?vizGovernor=0")).toBe(false);
    setVizGovernorSetting(false);
    expect(resolveVizGovernorEnabled("?vizGovernor=1")).toBe(true);
    expect(resolveVizGovernorEnabled("?vizGovernor=0")).toBe(false);
  });

  it("(6) the toggle label and help text match", () => {
    const toggle = createVizGovernorToggle({} as RenderScaleGovernorHost);
    expect(toggle.el.querySelector(".txt")?.textContent).toBe("Render governor");
    expect(toggle.el.title).toBe(HELP);
    expect(toggle.el.title).not.toContain("vizGovernor");
  });
});
