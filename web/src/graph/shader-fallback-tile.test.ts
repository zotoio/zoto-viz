import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderHost } from "./render-host";
import { TileShaderFallback } from "./tile-shader-fallback";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { packetTunnelFallbackText } from "../../../plugins/src/packet-tunnel/frontend/tunnel";

describe("shader fallback tile overlay", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("simple-view-literal", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "N", showChip: true, initialText: "line" });
    expect(mount.querySelector(".tile-shader-fallback-chip")!.textContent).toBe("Simple view");
    fb.dispose();
    mount.remove();
  });

  it("tunnel-line-literal", () => {
    expect(packetTunnelFallbackText({ t: 0, packets: [] })).toBe("DATA 0.50 · depth 0.60");
  });

  it("copy-default-name", () => {
    expect(genericShaderFallbackMessage("")).toBe(
      "This view can't run its graphics on this device. Other tiles aren't affected.",
    );
  });

  it("copy-named-tile", () => {
    expect(genericShaderFallbackMessage("Nixie Clock")).toBe(
      "Nixie Clock can't run its graphics on this device. Other tiles aren't affected.",
    );
  });

  it("clear-untracks-fallback", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "k", "demo", pane, "Quiet", true);
    host.onTileShaderCompileFailed("t");
    host.clearShaderFallback("t");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("swap-untracks-fallback", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const pane = document.createElement("div");
    wall.appendChild(pane);
    const host = new RenderHost(wall);
    host.beginTilePack("t", "a:1", "demo", pane, "A", true);
    host.onTileShaderCompileFailed("t");
    host.beginTilePack("t", "b:1", "nixie-clock", pane, "B", true);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
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
    host.beginTilePack("t", "a:1", "bad", pane, "A", true);
    expect(host.compilePluginSky("t", {} as never, {} as never)).toBe(false);
    rd.compile = vi.fn() as typeof rd.compile;
    host.beginTilePack("t", "b:1", "good", pane, "B", true);
    expect(host.compilePluginSky("t", {} as never, {} as never)).toBe(true);
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
