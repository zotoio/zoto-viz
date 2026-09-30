import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
  genericShaderFallbackMessage,
} from "./shader-fallback-copy";
import { drawOneHostFrame, failCompileWith } from "./shader-fallback-test-helpers";

describe("shader fallback gl context", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function hostWithGl(failTiles = new Set<string>()): {
    host: RenderHost;
    wall: HTMLElement;
    pane: HTMLElement;
  } {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    vi.spyOn(host, "compilePluginSky").mockImplementation((tileId) => !failTiles.has(tileId));
    Object.defineProperty(host, "software", { value: false });
    return { host, wall, pane };
  }

  it("context-loss-notice-no-generic", () => {
    const { host, wall, pane } = hostWithGl();
    host.beginTilePack("t", "nixie:1", "nixie-clock", pane, "Nixie", true);
    host.compilePluginSky("t", {} as never, {} as never);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const notices = wall.querySelectorAll(".gfx-wall-notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toBe(GFX_INTERRUPTED_NOTICE);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("context-restore-recompile", () => {
    const { host, wall, pane } = hostWithGl();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.beginTilePack("t", "nixie:1", "nixie-clock", pane, "Nixie", true);
    host.compilePluginSky("t", {} as never, {} as never);
    const deadPane = document.createElement("div");
    wall.appendChild(deadPane);
    host.beginTilePack("dead", "g:1", "gone-pack", deadPane, "Gone", true);
    vi.mocked(host.compilePluginSky).mockRestore();
    Object.defineProperty(host, "software", { value: false });
    failCompileWith(host, "dead", scene, camera, { shaderLog: "shader failed" });
    host.onTileShaderCompileFailed("dead");
    const compile = vi.spyOn(host.renderer as THREE.WebGLRenderer, "compile").mockImplementation(() => {});
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    drawOneHostFrame(host, wall); // the notice clears on the first drawn frame after the restore (#179)
    expect(wall.querySelectorAll(".gfx-wall-notice").length).toBe(0);
    compile.mockClear();
    host.compilePluginSky("dead", scene, camera);
    expect(compile).toHaveBeenCalledTimes(1);
    host.dispose();
    wall.remove();
  });

  it("context-loss-no-restore-timeout", () => {
    const { host, wall } = hostWithGl();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(10_000);
    const notice = wall.querySelector(".gfx-wall-notice")!;
    expect(notice.textContent).toBe(`${GFX_NO_RESTORE_NOTICE}Reload`);
    host.dispose();
    wall.remove();
  });

  it("late-restore-clears-reload", () => {
    const { host, wall } = hostWithGl();
    const invalidate = vi.spyOn(host, "invalidate");
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(10_000);
    expect(wall.querySelectorAll(".gfx-wall-reload").length).toBe(1);
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    drawOneHostFrame(host, wall); // the notice clears on the first drawn frame after the restore (#179)
    expect(wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
    expect(invalidate).toHaveBeenCalledTimes(1);
    host.dispose();
    wall.remove();
  });

  it("gfx-notice-copy-literals", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(wall.querySelector(".gfx-wall-notice")!.textContent).toBe(GFX_INTERRUPTED_NOTICE);
    host.dispose();
    wall.remove();
  });
});
