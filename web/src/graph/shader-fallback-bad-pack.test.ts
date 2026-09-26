import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import * as fallbackCopy from "./shader-fallback-copy";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { TileShaderFallback } from "./tile-shader-fallback";

describe("shader fallback bad pack text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("fallback-throws-latched", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "Boom Pack", showChip: true });
    const inner = fb as unknown as { writeText: (s: string) => void };
    const textEl = mount.querySelector(".tile-shader-fallback__text") as HTMLSpanElement;
    vi.spyOn(inner, "writeText")
      .mockImplementationOnce(() => { throw new Error("boom"); })
      .mockImplementation((s: string) => { textEl.textContent = s; });
    const genSpy = vi.spyOn(fallbackCopy, "genericShaderFallbackMessage");
    fb.pushPackText("01 05 00");
    fb.pushPackText("01 05 01");
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(mount.querySelector(".tile-shader-fallback__text")?.textContent)
      .toBe(genericShaderFallbackMessage("Boom Pack"));
    expect(mount.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    genSpy.mockRestore();
    mount.remove();
  });

  it("fallback-empty-latched", () => {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "empty:1", "empty", pane, "Empty Pack", true);
    host.mountShaderFallback("t");
    const genSpy = vi.spyOn(fallbackCopy, "genericShaderFallbackMessage");
    host.pushPackFallbackText("t", "   ");
    for (let i = 0; i < 600; i++) host.pushPackFallbackText("t", "   ");
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent)
      .toBe(genericShaderFallbackMessage("Empty Pack"));
    genSpy.mockRestore();
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
