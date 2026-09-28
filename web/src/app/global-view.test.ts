import { describe, expect, it } from "vitest";
import type { PluginLook } from "../plugins/plugin";
import { globalViewLeavesMosaic } from "./global-view";

const koi: PluginLook = { mosaic: "off", backdrop: "plugin", stageOnly: true };
const topology: PluginLook = { backdrop: "space" };
const syscon: PluginLook = {
  mosaic: "8",
  hero: "off",
  mosaicTiles: ["plugin:cores", "plugin:memory"],
};

describe("globalViewLeavesMosaic", () => {
  it("leaves the wall for a solo view such as koi pond", () => {
    expect(globalViewLeavesMosaic(true, koi)).toBe(true);
    expect(globalViewLeavesMosaic(true, topology)).toBe(true);
    expect(globalViewLeavesMosaic(true, undefined)).toBe(true);
  });

  it("keeps a catalog wall when that view is the mosaic", () => {
    expect(globalViewLeavesMosaic(true, syscon)).toBe(false);
  });

  it("does nothing while the wall is already off", () => {
    expect(globalViewLeavesMosaic(false, koi)).toBe(false);
  });
});
