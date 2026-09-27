import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import * as fallbackCopy from "./shader-fallback-copy";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { FALLBACK_GRACE_FRAMES } from "./shader-fallback-test-helpers";
import type { VizDataFrame } from "../plugins/viz-host";

const EMPTY: VizDataFrame = {
  t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

describe("shader fallback bad pack text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("fallback-empty-latched", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "empty:1", "empty", pane, "Empty Pack");
    host.onTileShaderCompileFailed("t");
    const genSpy = vi.spyOn(fallbackCopy, "genericShaderFallbackMessage");
    host.receiveFallbackPush("t", "   ");
    for (let i = 0; i < 600; i++) host.receiveFallbackPush("t", "   ");
    for (let i = 0; i < FALLBACK_GRACE_FRAMES; i++) host.driveShaderFallbacks(EMPTY);
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent)
      .toBe(genericShaderFallbackMessage("Empty Pack"));
    genSpy.mockRestore();
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
