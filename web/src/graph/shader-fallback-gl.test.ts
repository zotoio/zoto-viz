import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import {
  GFX_INTERRUPTED_NOTICE,
  GFX_NO_RESTORE_NOTICE,
  genericShaderFallbackMessage,
} from "./shader-fallback-copy";
import { GFX_WALL_NOTICE_CLASS, GFX_WALL_RELOAD_CLASS } from "./gfx-wall-notice";
import { SHADER_FALLBACK_CHIP_CLASS, SHADER_FALLBACK_CLASS } from "./tile-shader-fallback";
import { packFallbackText } from "../plugins/viz-pack-fallback";

const FRAG = "void main() { fragColor = vec4(1.0); }";
const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;

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
    compileShader: ReturnType<typeof vi.fn>;
    tileIdForCall: { current: string };
  } {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    const pane = document.createElement("div");
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const compileShader = vi.fn();
    const tileIdForCall = { current: "t" };
    const gl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS,
      LINK_STATUS,
      createShader: () => ({}),
      createProgram: () => ({}),
      shaderSource: vi.fn(),
      compileShader,
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getShaderParameter: () => !failTiles.has(tileIdForCall.current),
      getProgramParameter: (_p: unknown, p: number) => (p === LINK_STATUS),
      getShaderInfoLog: () => "",
      getProgramInfoLog: () => "",
    };
    vi.spyOn(host, "gl", "get").mockReturnValue(gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    const origBuild = host.buildTileShader.bind(host);
    host.buildTileShader = (tileId, frag, log) => {
      tileIdForCall.current = tileId;
      return origBuild(tileId, frag, log);
    };
    return { host, wall, pane, compileShader, tileIdForCall };
  }

  it("context-loss-notice-no-generic", () => {
    const { host, wall, pane } = hostWithGl();
    host.beginTilePack("t", "nixie:1", pane, "Nixie", packFallbackText("nixie-clock"));
    host.buildTileShader("t", FRAG);
    host.dispatchContextLost();
    const notices = wall.querySelectorAll(`.${GFX_WALL_NOTICE_CLASS}`);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toBe(GFX_INTERRUPTED_NOTICE);
    expect(notices[0]?.getAttribute("role")).toBe("status");
    expect((notices[0] as HTMLElement).tabIndex).toBe(-1);
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`).length).toBe(1);
    expect(pane.querySelectorAll(`.${SHADER_FALLBACK_CHIP_CLASS}`).length).toBe(1);
    expect(pane.textContent).not.toContain(genericShaderFallbackMessage("Nixie"));
    host.dispose();
    wall.remove();
  });

  it("context-restore-recompile", () => {
    const failTiles = new Set(["dead"]);
    const { host, wall, pane, compileShader } = hostWithGl(failTiles);
    host.beginTilePack("t", "nixie:1", pane, "Nixie", packFallbackText("nixie-clock"));
    host.buildTileShader("t", FRAG);
    const deadPane = document.createElement("div");
    wall.appendChild(deadPane);
    host.beginTilePack("dead", "g:1", deadPane, "Gone", undefined);
    expect(host.buildTileShader("dead", FRAG)).toBe(false);
    host.showCompileFallback("dead");
    const deadBefore = compileShader.mock.calls.length;
    host.dispatchContextLost();
    host.dispatchContextRestored();
    expect(wall.querySelectorAll(`.${GFX_WALL_NOTICE_CLASS}`).length).toBe(0);
    expect(host.buildTileShader("t", FRAG)).toBe(true);
    expect(compileShader.mock.calls.length - deadBefore).toBe(2);
    expect(host.buildTileShader("dead", FRAG)).toBe(false);
    expect(compileShader.mock.calls.length - deadBefore).toBe(2);
    expect(deadPane.querySelector(`.${SHADER_FALLBACK_CLASS}`)?.textContent)
      .toContain(genericShaderFallbackMessage("Gone"));
    host.dispose();
    wall.remove();
  });

  it("context-loss-no-restore-timeout", () => {
    const { host, wall } = hostWithGl();
    host.dispatchContextLost();
    vi.advanceTimersByTime(10_000);
    const notice = wall.querySelector(`.${GFX_WALL_NOTICE_CLASS}`)!;
    expect(notice.querySelector("span")?.textContent).toBe(GFX_NO_RESTORE_NOTICE);
    expect(notice.querySelectorAll(`.${GFX_WALL_RELOAD_CLASS}`).length).toBe(1);
    host.dispose();
    wall.remove();
  });

  function reloadLineCount(wall: HTMLElement): number {
    return wall.querySelectorAll(`.${GFX_WALL_NOTICE_CLASS} span`).length;
  }

  it("late-restore-clears-reload", () => {
    const { host, wall } = hostWithGl();
    const invalidate = vi.spyOn(host, "invalidate");
    host.dispatchContextLost();
    vi.advanceTimersByTime(10_000);
    expect(reloadLineCount(wall)).toBe(1);
    expect(wall.querySelectorAll(`.${GFX_WALL_RELOAD_CLASS}`).length).toBe(1);

    const sentinel = document.createElement("button");
    sentinel.textContent = "hold-focus";
    wall.appendChild(sentinel);
    sentinel.focus();
    const focusBefore = document.activeElement;
    host.dispatchContextRestored();
    expect(reloadLineCount(wall)).toBe(0);
    expect(wall.querySelectorAll(`.${GFX_WALL_RELOAD_CLASS}`).length).toBe(0);
    expect(document.activeElement).toBe(focusBefore);
    expect(invalidate).toHaveBeenCalled();

    host.dispatchContextLost();
    vi.advanceTimersByTime(10_000);
    const reloadBtn = wall.querySelector(`.${GFX_WALL_RELOAD_CLASS}`) as HTMLButtonElement;
    reloadBtn.focus();
    expect(document.activeElement).toBe(reloadBtn);
    invalidate.mockClear();
    host.dispatchContextRestored();
    expect(reloadLineCount(wall)).toBe(0);
    expect(wall.querySelectorAll(`.${GFX_WALL_RELOAD_CLASS}`).length).toBe(0);
    expect(document.activeElement).toBe(wall);
    expect(wall.tabIndex).toBe(-1);
    expect(document.activeElement).not.toBe(document.body);
    expect(invalidate).toHaveBeenCalled();
    host.dispose();
    wall.remove();
  });

  it("gfx-notice-copy-literals", () => {
    expect(GFX_INTERRUPTED_NOTICE).toBe("Graphics were interrupted. Restoring the wall…");
    expect(GFX_NO_RESTORE_NOTICE).toBe("Graphics didn't come back. Reload to restore the wall.");
    expect(genericShaderFallbackMessage("Demo")).toBe(
      "‹Demo› can't run its graphics on this device. Other tiles aren't affected.",
    );
  });
});
