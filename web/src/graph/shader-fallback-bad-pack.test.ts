import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import * as shaderPackFallback from "./shader-pack-fallback";

describe("shader fallback bad pack text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("fallback-empty-latched", () => {
    vi.spyOn(shaderPackFallback, "shaderPackForId").mockReturnValue({
      fallbackText: () => "   ",
    });
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "empty:1", "empty", pane, "Empty Pack", true);
    host.onTileShaderCompileFailed("t");
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent)
      .toBe(genericShaderFallbackMessage("Empty Pack"));
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    vi.restoreAllMocks();
    host.dispose();
    wall.remove();
  });
});
