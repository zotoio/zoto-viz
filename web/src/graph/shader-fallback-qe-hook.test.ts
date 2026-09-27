import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { failCompileWith } from "./shader-fallback-test-helpers";
import { RenderHost } from "./render-host";
import * as shaderPackFallback from "./shader-pack-fallback";
import type { ShaderPack } from "./shader-pack-fallback";

describe("shader fallback QE hook", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function mockShaderPacks(entries: Record<string, ShaderPack>): void {
    const orig = shaderPackFallback.shaderPackForId;
    vi.spyOn(shaderPackFallback, "shaderPackForId").mockImplementation((id) => {
      if (id in entries) return entries[id]!;
      return orig.call(shaderPackFallback, id);
    });
  }

  function twoTileHost(): {
    host: RenderHost;
    wall: HTMLElement;
    paneA: HTMLElement;
    paneB: HTMLElement;
  } {
    const wall = document.createElement("div");
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    wall.append(paneA, paneB);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    return { host, wall, paneA, paneB };
  }

  it("qe-per-tile-isolation", () => {
    const hookA = vi.fn(() => "line-a");
    const hookB = vi.fn(() => "line-b");
    mockShaderPacks({
      "pack-a": { fallbackText: hookA },
      "pack-b": { fallbackText: hookB },
    });
    const { host, wall, paneA, paneB } = twoTileHost();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    host.beginTilePack("a", "ka", "pack-a", paneA, "Pack A", true);
    failCompileWith(host, "a", scene, camera, { shaderLog: "err" });
    host.onTileShaderCompileFailed("a");
    host.beginTilePack("b", "kb", "pack-b", paneB, "Pack B", true);
    host.onTileShaderCompileFailed("b");
    hookA.mockClear();
    hookB.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(hookB).toHaveBeenCalledTimes(3);
    expect(hookA).toHaveBeenCalledTimes(0);
    host.dispose();
    wall.remove();
  });

  it("qe-throw-isolation", () => {
    let aCalls = 0;
    const hookA = vi.fn(() => {
      aCalls += 1;
      if (aCalls > 1) throw new Error("boom");
      return "a0";
    });
    const hookB = vi.fn(() => "line-b");
    mockShaderPacks({
      "pack-a": { fallbackText: hookA },
      "pack-b": { fallbackText: hookB },
    });
    const { host, wall, paneA, paneB } = twoTileHost();
    host.beginTilePack("a", "ka", "pack-a", paneA, "Pack A", true);
    host.onTileShaderCompileFailed("a");
    host.beginTilePack("b", "kb", "pack-b", paneB, "Pack B", true);
    host.onTileShaderCompileFailed("b");
    hookA.mockClear();
    hookB.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(hookB).toHaveBeenCalledTimes(3);
    expect(paneA.querySelector(".tile-shader-fallback__text")?.textContent).toBe(
      genericShaderFallbackMessage("Pack A"),
    );
    host.dispose();
    wall.remove();
  });

  it("qe-hook-context-loss", () => {
    const hook = vi.fn(() => "line");
    mockShaderPacks({ "hook-pack": { fallbackText: hook } });
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k", "hook-pack", pane, "Hook", true);
    host.onTileShaderCompileFailed("t");
    hook.mockClear();
    const timersBeforeLoss = vi.getTimerCount();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(vi.getTimerCount()).toBe(timersBeforeLoss);
    vi.advanceTimersByTime(20_000);
    expect(hook).toHaveBeenCalledTimes(0);
    host.dispose();
    wall.remove();
  });
});
