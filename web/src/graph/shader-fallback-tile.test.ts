import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import { TileShaderFallback } from "./tile-shader-fallback";
import * as shaderFallbackCopy from "./shader-fallback-copy";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { FALLBACK_GRACE_FRAMES } from "./shader-fallback-test-helpers";
import type { VizDataFrame } from "../plugins/viz-host";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";

const EMPTY: VizDataFrame = {
  t: 0, dt: 0.016, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

function drive(host: RenderHost, n: number): void {
  for (let i = 0; i < n; i++) host.driveShaderFallbacks(EMPTY);
}

describe("shader fallback tile overlay", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("grace-hidden", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    new TileShaderFallback(mount, { packName: "N", packPush: true });
    expect(mount.querySelector(".tile-shader-fallback")!.style.visibility).toBe("hidden");
    mount.remove();
  });

  it("simple-view-literal", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "N", packPush: true });
    fb.pushPackText("line");
    expect(mount.querySelector(".tile-shader-fallback-chip")!.textContent).toBe("Simple view");
    fb.dispose();
    mount.remove();
  });

  it("ctxloss-chip", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    host.beginTilePack("t", "k", "nixie-clock", pane, "N");
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(pane.querySelectorAll(".tile-shader-fallback-chip").length).toBe(1);
    host.dispose();
    wall.remove();
  });

  it("ctxloss-shows-staged-line", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    host.beginTilePack("t", "k", "nixie-clock", pane, "N");
    host.receiveFallbackPush("t", "01 05 00");
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent).toBe("01 05 00");
    host.dispose();
    wall.remove();
  });

  it("tunnel-line-literal", () => {
    expect(packetTunnelFallbackText({ t: 0, packets: [] })).toBe("DATA 0.50 · depth 0.60");
  });

  it("copy-default-name", () => {
    expect(genericShaderFallbackMessage("")).toBe(
      "‹This view› can't run its graphics on this device. Other tiles aren't affected.",
    );
  });

  it("clear-untracks-fallback", () => {
    const spy = vi.spyOn(shaderFallbackCopy, "genericShaderFallbackMessage");
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k", "demo", pane, "Quiet");
    host.onTileShaderCompileFailed("t");
    host.clearShaderFallback("t");
    drive(host, FALLBACK_GRACE_FRAMES);
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
    host.dispose();
    wall.remove();
  });

  it("swap-untracks-fallback", () => {
    const spy = vi.spyOn(shaderFallbackCopy, "genericShaderFallbackMessage");
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "a:1", "demo", pane, "A");
    host.onTileShaderCompileFailed("t");
    host.beginTilePack("t", "b:1", "nixie-clock", pane, "B");
    drive(host, FALLBACK_GRACE_FRAMES + 5);
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
    host.dispose();
    wall.remove();
  });

  it("swap-drops-staged", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "a:1", "nixie-clock", pane, "A");
    host.receiveFallbackPush("t", "A-LINE");
    const rd = host.renderer as THREE.WebGLRenderer;
    const gl = {
      getShaderInfoLog: () => "err",
      getProgramInfoLog: () => "",
    } as unknown as WebGL2RenderingContext;
    rd.compile = vi.fn(() => {
      rd.debug!.onShaderError!(gl, {} as never, {} as never, {} as never);
    }) as typeof rd.compile;
    host.beginTilePack("t", "b:1", "nixie-clock", pane, "B");
    host.compilePluginSky("t", {} as never, {} as never);
    host.onTileShaderCompileFailed("t");
    expect(pane.querySelector(".tile-shader-fallback")!.style.visibility).toBe("hidden");
    host.dispose();
    wall.remove();
  });

  it("swap-resets-latch", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    const rd = host.renderer as THREE.WebGLRenderer;
    const gl = {
      getShaderInfoLog: () => "err",
      getProgramInfoLog: () => "",
    } as unknown as WebGL2RenderingContext;
    rd.compile = vi.fn(() => {
      rd.debug!.onShaderError!(gl, {} as never, {} as never, {} as never);
    }) as typeof rd.compile;
    host.beginTilePack("t", "a:1", "bad", pane, "A");
    expect(host.compilePluginSky("t", {} as never, {} as never)).toBe(false);
    rd.compile = vi.fn() as typeof rd.compile;
    host.beginTilePack("t", "b:1", "good", pane, "B");
    expect(host.compilePluginSky("t", {} as never, {} as never)).toBe(true);
    host.dispose();
    wall.remove();
  });

  it("restore-clears-loss-overlay", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k", "nixie-clock", pane, "N");
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("load-during-loss-not-failed", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const err = host.probeTileSky("t", {} as THREE.Scene, {} as THREE.Camera);
    expect(err).toBeNull();
    host.dispose();
    wall.remove();
  });

  it("loss-twice-one-notice", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(wall.querySelectorAll(".gfx-wall-notice").length).toBe(1);
    host.dispose();
    wall.remove();
  });
});
