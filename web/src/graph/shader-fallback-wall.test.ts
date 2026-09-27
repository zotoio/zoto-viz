import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { TileShaderFallback } from "./tile-shader-fallback";
import type { VizDataFrame } from "../plugins/viz-host";

const EMPTY: VizDataFrame = {
  t: 0, dt: 0.016, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

function drive(host: RenderHost, n: number): void {
  for (let i = 0; i < n; i++) host.driveShaderFallbacks(EMPTY);
}

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
    host.beginTilePack("t1", "bad:1", "bad", pane, "Bad");
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(false);
    host.onTileShaderCompileFailed("t1");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    failTiles.delete("t1");
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(true);
    host.onTileShaderCompileOk("t1");
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good");
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(true);
    host.dispose();
    wall.remove();
  });

  it("drive-writes-tile", () => {
    const { wall, host } = hostWall();
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    wall.append(paneA, paneB);
    host.beginTilePack("pane-b", "p:1", "nixie-clock", paneB, "Nixie");
    host.beginTilePack("pane-h", "p:0", "nixie-clock", paneA, "Nixie");
    host.onTileShaderCompileFailed("pane-b");
    host.receiveFallbackPush("pane-b", "01 05 00");
    expect(paneB.querySelector(".tile-shader-fallback__text")?.textContent).toBe("01 05 00");
    expect(paneA.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("fallback-survives-sky-reset", () => {
    const { wall, host, failTiles } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    failTiles.add("main");
    host.beginTilePack("main", "k:1", "nixie-clock", pane, "Nixie");
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
