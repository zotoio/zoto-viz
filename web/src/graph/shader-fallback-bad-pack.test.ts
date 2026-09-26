import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { SHADER_FALLBACK_CHIP_CLASS, SHADER_FALLBACK_CLASS } from "./tile-shader-fallback";
import * as fallbackCopy from "./shader-fallback-copy";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import type { VizDataFrame } from "../plugins/viz-host";

const EMPTY_FRAME: VizDataFrame = {
  t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

describe("shader fallback bad pack text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("fallback-throws-latched", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    let calls = 0;
    const throwing = () => {
      calls++;
      throw new Error("boom");
    };
    host.beginTilePack("t", "throw:1", pane, "Boom Pack", throwing);
    host.showCompileFallback("t");
    const genSpy = vi.spyOn(fallbackCopy, "genericShaderFallbackMessage");
    for (let i = 0; i < 600; i++) host.driveShaderFallback("t", EMPTY_FRAME);
    expect(calls).toBe(1);
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(host.tileSlot("t").fallback!.textNode.textContent)
      .toBe(genericShaderFallbackMessage("Boom Pack"));
    genSpy.mockRestore();
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CHIP_CLASS}`).length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("fallback-empty-latched", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    let calls = 0;
    const empty = () => {
      calls++;
      return "   ";
    };
    host.beginTilePack("t", "empty:1", pane, "Empty Pack", empty);
    host.showCompileFallback("t");
    const genSpy = vi.spyOn(fallbackCopy, "genericShaderFallbackMessage");
    for (let i = 0; i < 600; i++) host.driveShaderFallback("t", EMPTY_FRAME);
    expect(calls).toBe(1);
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(host.tileSlot("t").fallback!.textNode.textContent)
      .toBe(genericShaderFallbackMessage("Empty Pack"));
    genSpy.mockRestore();
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CHIP_CLASS}`).length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
