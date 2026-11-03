import { describe, expect, it } from "vitest";
import { changedPluginStores } from "./plugin-config-diff";

describe("changedPluginStores (set_plugin reaches every pane on that store)", () => {
  it("lists only stores whose knobs changed", () => {
    const before = new Map([["zoto-viz.plugin.fractal-zoom.preset", "mandel-terrain"], ["zoto-viz.plugin.aquarium.fish", "9"]]);
    const after = new Map([["zoto-viz.plugin.fractal-zoom.preset", "menger-tunnel"], ["zoto-viz.plugin.aquarium.fish", "9"], ["zoto-viz.plugin.carousel:apod.source", "apod"]]);
    expect(changedPluginStores(before, after).sort()).toEqual(["carousel:apod", "fractal-zoom"]);
    expect(changedPluginStores(after, after)).toEqual([]);
    expect(changedPluginStores(before, new Map())).toEqual(expect.arrayContaining(["fractal-zoom", "aquarium"]));
  });
});
