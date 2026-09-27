import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
  genericShaderFallbackMessage,
} from "./shader-fallback-copy";

describe("shader fallback UX overlays", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("wall-notice-interrupted-literal", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const pin = "Graphics were interrupted. Restoring the wall\u2026";
    expect(GFX_INTERRUPTED_NOTICE.at(-1)).toBe("\u2026");
    expect(GFX_INTERRUPTED_NOTICE).toBe(pin);
    expect(wall.querySelector(".gfx-wall-notice")!.textContent).toBe(pin);
    host.dispose();
    wall.remove();
  });

  it("wall-notice-no-restore-literal", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(10_000);
    const notice = wall.querySelector(".gfx-wall-notice")!;
    expect(notice.querySelector("span")?.textContent).toBe(GFX_NO_RESTORE_NOTICE);
    expect(notice.querySelector(".gfx-wall-reload")?.textContent).toBe("Reload");
    host.dispose();
    wall.remove();
  });

  it("context-loss-no-tile-overlay", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "nixie:1", "nixie-clock", pane, "Nixie Clock", true);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(wall.querySelectorAll(".gfx-wall-notice").length).toBe(1);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(wall.querySelectorAll(".gfx-wall-notice").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("shader-fail-with-pack-fallback-text", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k:1", "nixie-clock", pane, "Nixie Clock", true);
    host.onTileShaderCompileFailed("t");
    const text = pane.querySelector(".tile-shader-fallback__text")?.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe(genericShaderFallbackMessage("Nixie Clock"));
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(1);
    host.dispose();
    wall.remove();
  });

  it("shader-fail-no-hook-generic", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k:1", "quiet-shader", pane, "Quiet Pack", true);
    host.onTileShaderCompileFailed("t");
    const want = genericShaderFallbackMessage("Quiet Pack");
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent).toBe(want);
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("pack-load-during-loss-recovers", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    host.beginTilePack("t", "k", "demo", pane, "Demo Pack", true);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(host.probeTileSky("t", {} as THREE.Scene, {} as THREE.Camera)).toBeNull();
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    const rd = host.renderer as THREE.WebGLRenderer;
    rd.compile = vi.fn() as typeof rd.compile;
    expect(host.compilePluginSky("t", {} as THREE.Scene, {} as THREE.Camera)).toBe(true);
    host.onTileShaderCompileOk("t");
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
