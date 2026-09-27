import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { TileShaderFallback } from "./tile-shader-fallback";

function hostWall(): { wall: HTMLElement; host: RenderHost; failTiles: Set<string> } {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 640 });
  Object.defineProperty(wall, "clientHeight", { value: 480 });
  document.body.appendChild(wall);
  const host = new RenderHost(wall);
  const failTiles = new Set<string>();
  vi.spyOn(host, "compilePluginSky").mockImplementation((tileId) => !failTiles.has(tileId));
  Object.defineProperty(host, "software", { value: false });
  return { wall, host, failTiles };
}

describe("shader fallback wall", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("pack-swap-clears-fallback", () => {
    const { wall, host, failTiles } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    failTiles.add("t1");
    host.beginTilePack("t1", "bad:1", "bad", pane, "Bad", true);
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(false);
    host.onTileShaderCompileFailed("t1");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    failTiles.delete("t1");
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good", true);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("drive-writes-tile", () => {
    const { wall, host } = hostWall();
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    wall.append(paneA, paneB);
    host.beginTilePack("pane-b", "p:1", "nixie-clock", paneB, "Nixie", true);
    host.beginTilePack("pane-h", "p:0", "nixie-clock", paneA, "Nixie", true);
    host.onTileShaderCompileFailed("pane-b");
    const line = paneB.querySelector(".tile-shader-fallback__text")?.textContent ?? "";
    expect(line.length).toBeGreaterThan(0);
    expect(paneA.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("fallback-survives-sky-reset", () => {
    const { wall, host, failTiles } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    failTiles.add("main");
    host.beginTilePack("main", "k:1", "nixie-clock", pane, "Nixie", true);
    expect(host.compilePluginSky("main", {} as never, {} as never)).toBe(false);
    const dispose = vi.spyOn(TileShaderFallback.prototype, "dispose");
    host.onTileShaderCompileFailed("main");
    host.onTileShaderCompileFailed("main");
    expect(pane.querySelectorAll(".tile-shader-fallback")).toHaveLength(1);
    expect(dispose).toHaveBeenCalledTimes(0);
    dispose.mockRestore();
    host.dispose();
    wall.remove();
  });
});
