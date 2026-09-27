import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { trackTextWrites } from "./shader-fallback-test-helpers";
import * as shaderPackFallback from "./shader-pack-fallback";
import type { ShaderPack } from "./shader-pack-fallback";

describe("shader fallback pack hook", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function setup(packId = "hook-pack", packName = "Hook Pack") {
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const enter = () => {
      host.beginTilePack("t", "k:1", packId, pane, packName, true);
      host.onTileShaderCompileFailed("t");
    };
    const textEl = () => pane.querySelector(".tile-shader-fallback__text") as HTMLElement | null;
    return { host, wall, pane, enter, textEl };
  }

  function mockShaderPack(packId: string, pack: ShaderPack): void {
    const orig = shaderPackFallback.shaderPackForId;
    vi.spyOn(shaderPackFallback, "shaderPackForId").mockImplementation((id) => {
      if (id === packId) return pack;
      return orig(id);
    });
  }

  it("entry-call", () => {
    const hook = vi.fn(() => "line-a");
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, enter } = setup();
    enter();
    expect(hook).toHaveBeenCalledTimes(1);
    host.dispose();
    wall.remove();
  });

  it("tick-5s", () => {
    const hook = vi.fn(() => "line-a");
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, enter } = setup();
    enter();
    hook.mockClear();
    vi.advanceTimersByTime(4999);
    expect(hook).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(hook).toHaveBeenCalledTimes(1);
    host.dispose();
    wall.remove();
  });

  it("no-rewrite-same", () => {
    const hook = vi.fn(() => "same");
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, pane, enter } = setup();
    enter();
    const text = pane.querySelector(".tile-shader-fallback__text") as HTMLElement;
    const tracker = trackTextWrites(text);
    hook.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(hook).toHaveBeenCalledTimes(3);
    expect(tracker.writes).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("rewrite-on-change", () => {
    let n = 0;
    const hook = vi.fn(() => (n++ === 0 ? "first" : "second"));
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, enter, textEl } = setup();
    enter();
    expect(textEl()?.textContent).toBe("first");
    vi.advanceTimersByTime(5000);
    expect(textEl()?.textContent).toBe("second");
    host.dispose();
    wall.remove();
  });

  it("teardown-swap", () => {
    const hook = vi.fn(() => "x");
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, pane, enter } = setup();
    enter();
    const timersWithFallback = vi.getTimerCount();
    hook.mockClear();
    host.beginTilePack("t", "k:2", "other-shader", pane, "Other", true);
    expect(vi.getTimerCount()).toBe(timersWithFallback - 1);
    vi.advanceTimersByTime(10_000);
    expect(hook).toHaveBeenCalledTimes(0);
    host.dispose();
    wall.remove();
  });

  it("teardown-dispose", () => {
    const hook = vi.fn(() => "x");
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, enter } = setup();
    enter();
    hook.mockClear();
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(hook).toHaveBeenCalledTimes(0);
    wall.remove();
  });

  it("shared-interval", () => {
    const hook = vi.fn(() => "x");
    mockShaderPack("hook-pack", { fallbackText: hook });
    const wall = document.createElement("div");
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    wall.append(paneA, paneB);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const base = vi.getTimerCount();
    host.beginTilePack("a", "ka", "hook-pack", paneA, "A", true);
    host.onTileShaderCompileFailed("a");
    expect(vi.getTimerCount()).toBe(base + 1);
    host.beginTilePack("b", "kb", "hook-pack", paneB, "B", true);
    host.onTileShaderCompileFailed("b");
    expect(vi.getTimerCount()).toBe(base + 1);
    host.clearShaderFallback("a");
    expect(vi.getTimerCount()).toBe(base + 1);
    host.clearShaderFallback("b");
    expect(vi.getTimerCount()).toBe(base);
    host.dispose();
    wall.remove();
  });

  it("throw-entry", () => {
    mockShaderPack("hook-pack", {
      fallbackText: () => {
        throw new Error("boom");
      },
    });
    const { host, wall, enter, textEl } = setup();
    enter();
    expect(textEl()?.textContent).toBe(genericShaderFallbackMessage("Hook Pack"));
    host.dispose();
    wall.remove();
  });

  it("throw-tick", () => {
    let fail = false;
    const hook = vi.fn(() => {
      if (fail) throw new Error("boom");
      return "ok";
    });
    mockShaderPack("hook-pack", { fallbackText: hook });
    const { host, wall, enter, textEl } = setup();
    enter();
    fail = true;
    vi.advanceTimersByTime(5000);
    expect(textEl()?.textContent).toBe(genericShaderFallbackMessage("Hook Pack"));
    host.dispose();
    wall.remove();
  });

  it("empty-string", () => {
    mockShaderPack("hook-pack", { fallbackText: () => "" });
    const { host, wall, enter, textEl } = setup();
    enter();
    expect(textEl()?.textContent).toBe(genericShaderFallbackMessage("Hook Pack"));
    host.dispose();
    wall.remove();
  });

  it("undefined-return", () => {
    mockShaderPack("hook-pack", { fallbackText: () => undefined });
    const { host, wall, enter, textEl } = setup();
    enter();
    expect(textEl()?.textContent).toBe(genericShaderFallbackMessage("Hook Pack"));
    host.dispose();
    wall.remove();
  });

  it("literal-markup", () => {
    const evil = "<img src=x onerror=alert(1)>";
    mockShaderPack("hook-pack", { fallbackText: () => evil });
    const { host, wall, pane, enter, textEl } = setup();
    enter();
    expect(textEl()?.textContent).toBe(evil);
    expect(pane.querySelectorAll("img").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("no-hook", () => {
    const hook = vi.fn(() => "nope");
    mockShaderPack("quiet-shader", {});
    const { host, wall, enter, textEl } = setup("quiet-shader", "Quiet Pack");
    enter();
    expect(textEl()?.textContent).toBe(genericShaderFallbackMessage("Quiet Pack"));
    expect(hook).toHaveBeenCalledTimes(0);
    host.dispose();
    wall.remove();
  });

  it("manifest-not-text", () => {
    const hook = vi.fn(() => "should-not-run");
    mockShaderPack("graph-pack", { fallbackText: hook });
    const wall = document.createElement("div");
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k", "graph-pack", pane, "Graph", false);
    host.onTileShaderCompileFailed("t");
    expect(hook).toHaveBeenCalledTimes(0);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
