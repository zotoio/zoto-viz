import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
  genericShaderFallbackMessage,
} from "./shader-fallback-copy";
import { GFX_WALL_NOTICE_CLASS, GFX_WALL_RELOAD_CLASS } from "./gfx-wall-notice";

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
    host.dispatchContextLost();
    const notices = wall.querySelectorAll(`.${GFX_WALL_NOTICE_CLASS}`);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toBe(GFX_INTERRUPTED_NOTICE);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    expect(pane.textContent).not.toContain(genericShaderFallbackMessage("Nixie"));
    host.dispose();
    wall.remove();
  });

  it("context-restore-recompile", () => {
    const failTiles = new Set(["dead"]);
    const { host, wall, pane } = hostWithGl(failTiles);
    host.beginTilePack("t", "nixie:1", "nixie-clock", pane, "Nixie", true);
    host.compilePluginSky("t", {} as never, {} as never);
    const deadPane = document.createElement("div");
    wall.appendChild(deadPane);
    host.beginTilePack("dead", "g:1", "gone-pack", deadPane, "Gone", false);
    expect(host.compilePluginSky("dead", {} as never, {} as never)).toBe(false);
    host.onTileShaderCompileFailed("dead");
    const compile = vi.mocked(host.compilePluginSky);
    const deadBefore = compile.mock.calls.length;
    host.dispatchContextLost();
    host.dispatchContextRestored();
    expect(wall.querySelectorAll(`.${GFX_WALL_NOTICE_CLASS}`).length).toBe(0);
    expect(host.tileSlot("dead").latch.dead).toBe(false);
    expect(host.compilePluginSky("t", {} as never, {} as never)).toBe(true);
    expect(compile.mock.calls.length - deadBefore).toBe(1);
    expect(host.compilePluginSky("dead", {} as never, {} as never)).toBe(false);
    host.dispose();
    wall.remove();
  });

  it("context-loss-no-restore-timeout", () => {
    const { host, wall } = hostWithGl();
    host.dispatchContextLost();
    vi.advanceTimersByTime(10_000);
    const notice = wall.querySelector(`.${GFX_WALL_NOTICE_CLASS}`)!;
    expect(notice.querySelector("span")?.textContent).toBe(GFX_NO_RESTORE_NOTICE);
    host.dispose();
    wall.remove();
  });

  it("late-restore-clears-reload", () => {
    const { host, wall } = hostWithGl();
    const invalidate = vi.spyOn(host, "invalidate");
    host.dispatchContextLost();
    vi.advanceTimersByTime(10_000);
    host.dispatchContextRestored();
    expect(wall.querySelectorAll(`.${GFX_WALL_RELOAD_CLASS}`).length).toBe(0);
    expect(invalidate).toHaveBeenCalled();
    host.dispose();
    wall.remove();
  });

  it("gfx-notice-copy-literals", () => {
    expect(GFX_INTERRUPTED_NOTICE).toBe("Graphics were interrupted. Restoring the wall…");
    expect(GFX_NO_RESTORE_NOTICE).toBe("Graphics didn't come back. Reload to restore the wall.");
  });
});
