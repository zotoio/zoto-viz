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

  it("healthy-wall-no-fallback", () => {
    const { wall, host, failTiles } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    host.beginTilePack("t1", "k", "nixie-clock", pane, "Nixie", true);
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(true);
    let pushes = 0;
    const orig = host.receiveFallbackPush.bind(host);
    host.receiveFallbackPush = (...args) => {
      pushes++;
      return orig(...args);
    };
    drive(host, 600);
    expect(wall.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(pushes).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("isolated-tile-failure", () => {
    const { wall, host, failTiles } = hostWall();
    const panes = new Map<string, HTMLElement>();
    for (const id of ["t1", "t2", "t3", "t4"]) {
      const p = document.createElement("div");
      panes.set(id, p);
      wall.appendChild(p);
    }
    failTiles.add("t1");
    for (const [id, pane] of panes) {
      host.beginTilePack(id, `p:${id}`, "nixie-clock", pane, "Pack", true);
      if (id === "t1") {
        expect(host.compilePluginSky(id, {} as never, {} as never)).toBe(false);
        host.onTileShaderCompileFailed(id);
      } else {
        expect(host.compilePluginSky(id, {} as never, {} as never)).toBe(true);
      }
    }
    drive(host, 600);
    expect(panes.get("t1")!.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    for (const id of ["t2", "t3", "t4"]) {
      expect(panes.get(id)!.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    }
    host.dispose();
    wall.remove();
  });

  it("pack-swap-clears-fallback", () => {
    const { wall, host, failTiles } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    failTiles.add("t1");
    host.beginTilePack("t1", "bad:1", "bad", pane, "Bad", false);
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(false);
    host.onTileShaderCompileFailed("t1");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    failTiles.delete("t1");
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good", true);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(true);
    host.onTileShaderCompileOk("t1");
    host.beginTilePack("t1", "good:2", "nixie-clock", pane, "Good", true);
    expect(host.compilePluginSky("t1", {} as never, {} as never)).toBe(true);
    host.dispose();
    wall.remove();
  });

  it("drive-writes-tile", () => {
    const { wall, host } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    host.beginTilePack("pane-b", "p:1", "nixie-clock", pane, "Nixie", true);
    host.onTileShaderCompileFailed("pane-b");
    host.receiveFallbackPush("pane-b", "X");
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent).toBe("X");
    host.dispose();
    wall.remove();
  });

  it("mosaic-tile-keyed", () => {
    const { wall, host } = hostWall();
    const panes = new Map<string, HTMLElement>();
    for (const id of ["t1", "t2"]) {
      const p = document.createElement("div");
      panes.set(id, p);
      wall.appendChild(p);
    }
    for (const id of ["t1", "t2"]) {
      host.beginTilePack(id, `k:${id}`, "nixie-clock", panes.get(id)!, "N", true);
      host.onTileShaderCompileFailed(id);
    }
    host.receiveFallbackPush("t1", "LINE-A");
    host.receiveFallbackPush("t2", "LINE-B");
    expect(panes.get("t1")!.querySelector(".tile-shader-fallback__text")?.textContent).toBe("LINE-A");
    expect(panes.get("t2")!.querySelector(".tile-shader-fallback__text")?.textContent).toBe("LINE-B");
    host.dispose();
    wall.remove();
  });

  it("scene-mounts-fallback", () => {
    const { wall, host, failTiles } = hostWall();
    const pane = document.createElement("div");
    wall.appendChild(pane);
    failTiles.add("pane-a");
    host.beginTilePack("pane-a", "bad:1", "nixie-clock", pane, "Nixie", true);
    expect(host.compilePluginSky("pane-a", {} as never, {} as never)).toBe(false);
    host.onTileShaderCompileFailed("pane-a");
    expect(pane.querySelectorAll(".tile-shader-fallback")).toHaveLength(1);
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
