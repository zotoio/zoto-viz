/**
 * #179 row 4 inside Fractal zoom (#180): the fractal tile's WebGL context is lost and then restored.
 * The wall notice must still be up after the restore while nothing has drawn, and clear only once a
 * real host frame has drawn (drawOneHostFrame), not on the `webglcontextrestored` event.
 *
 * The tile is booted the way main.ts installs a pack sky: NetScene.setPluginShader with the shipped
 * fractal-zoom `sky/fragment.glsl` and the pack's meta, on the shared RenderHost. The fake context
 * follows Chrome's `WEBGL_lose_context` rules (same as render-host-context-recovery.test.ts).
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FRACTAL_SKY from "../../../plugins/src/fractal-zoom/sky/fragment.glsl?raw";
import { NetScene } from "./scene";
import { RenderHost } from "./render-host";
import { GFX_INTERRUPTED_NOTICE } from "./shader-fallback-copy";
import { drawOneHostFrame } from "./shader-fallback-test-helpers";

const FRACTAL_META = { packId: "fractal-zoom", packName: "Fractal Zoom", packKey: "plugin:fractal-zoom" };

class FakeChromeGl {
  lost = false;
  restoreAllowed = false;
  readonly ext = {
    loseContext: () => this.loseContext(),
    restoreContext: () => this.restoreContext(),
  };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  isContextLost(): boolean { return this.lost; }
  fenceSync(): null { return null; }
  getContextAttributes(): { antialias: boolean } { return { antialias: false }; }
  getExtension(name: string): unknown {
    if (this.lost) return null;
    return name === "WEBGL_lose_context" ? this.ext : null;
  }
  getShaderInfoLog(): string { return ""; }
  getProgramInfoLog(): string { return ""; }

  loseContext(): void {
    if (this.lost) return;
    this.lost = true;
    setTimeout(() => {
      const e = new Event("webglcontextlost", { cancelable: true });
      this.canvas.dispatchEvent(e);
      this.restoreAllowed = e.defaultPrevented;
    }, 0);
  }

  /** GPU reset: lost now, event from a task, and the browser restores it by itself after `ms`. */
  browserLossAutoRestore(ms: number): void {
    this.loseContext();
    setTimeout(() => this.finishRestore(), ms);
  }

  restoreContext(): void {
    if (!this.lost || !this.restoreAllowed) return; // "context restoration not allowed"
    this.restoreAllowed = false;
    setTimeout(() => this.finishRestore(), 0);
  }

  finishRestore(): void {
    if (!this.lost) return;
    this.lost = false;
    this.canvas.dispatchEvent(new Event("webglcontextrestored"));
  }
}

function rect(w: number, h: number): () => DOMRect {
  return () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function notices(wall: HTMLElement): HTMLElement[] {
  return [...wall.querySelectorAll<HTMLElement>(".gfx-wall-notice")];
}

describe("#179 row 4 on the Fractal zoom tile (#180)", () => {
  let host: RenderHost | null = null;
  let wall: HTMLElement | null = null;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    // Frames run only when the test draws one: no rAF frame can clear the notice behind its back.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    host?.dispose();
    wall?.remove();
    host = null;
    wall = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fractal tile loses its WebGL context and restores: the notice stays up with no frame drawn, and clears only after one real drawn frame", () => {
    wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { value: 640 });
    Object.defineProperty(pane, "clientHeight", { value: 480 });
    wall.appendChild(pane);
    document.body.appendChild(wall);
    host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    const gl = new FakeChromeGl(host.canvas);
    const rd = host.renderer as unknown as THREE.WebGLRenderer;
    const render = vi.fn();
    const compile = vi.fn();
    Object.assign(rd, {
      getContext: () => gl,
      forceContextLoss: () => gl.ext.loseContext(),
      forceContextRestore: () => gl.ext.restoreContext(),
      render,
      compile,
    });
    host.canvas.getBoundingClientRect = rect(640, 480);
    pane.getBoundingClientRect = rect(640, 480);
    const scene = new NetScene(pane, { satellite: true, host, tileId: "main" });
    // Only drawOneHostFrame draws below (NetScene's own tick is not under test, as in #179's harness).
    host.remove(scene);

    // The fractal tile, installed the way main.ts does it: the shipped sky source plus the pack meta.
    expect(scene.setPluginShader({ id: "fractal-zoom", source: FRACTAL_SKY }, FRACTAL_META)).toBeNull();
    expect(compile).toHaveBeenCalledTimes(1);
    expect((scene as unknown as { backdrop: { pluginId: string | null } }).backdrop.pluginId).toBe("fractal-zoom");

    gl.browserLossAutoRestore(1_500);
    vi.advanceTimersByTime(0); // webglcontextlost
    expect(host.glContextLost).toBe(true);
    expect(notices(wall).map((n) => n.textContent)).toEqual([GFX_INTERRUPTED_NOTICE]);

    vi.advanceTimersByTime(1_500); // webglcontextrestored; nothing has drawn since
    expect(gl.lost).toBe(false);
    expect(host.glContextLost).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(
      notices(wall).map((n) => n.textContent),
      "fractal: the restored event alone must not clear the notice",
    ).toEqual([GFX_INTERRUPTED_NOTICE]);

    // A host frame in which nothing draws is not a recovery either.
    host.advanceFrame(16);
    expect(render).not.toHaveBeenCalled();
    expect(notices(wall).map((n) => n.textContent), "a frame that draws nothing must not clear it").toEqual([
      GFX_INTERRUPTED_NOTICE,
    ]);

    // The first real drawn frame clears it (still inside the 10 s window, so no Reload ever showed).
    drawOneHostFrame(host, wall, 32);
    expect(render).toHaveBeenCalledTimes(1);
    expect(notices(wall).length).toBe(0);
    expect(wall.querySelectorAll(".gfx-wall-reload").length).toBe(0);
    expect(host.tileShaderDead("main")).toBe(false);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(notices(wall).length).toBe(0);
  });
});
