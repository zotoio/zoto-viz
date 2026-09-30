import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetScene } from "./scene";
import { RenderHost } from "./render-host";
import { mockPartial } from "../../test-support/mock-partial";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";

const OK = `
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(dir, 1.0);
}
`;

function armCompileFail(host: RenderHost, shaderLog = "compile error"): void {
  const rd = host.renderer as THREE.WebGLRenderer;
  const gl = mockPartial<WebGL2RenderingContext>({
    getShaderInfoLog: () => shaderLog,
    getProgramInfoLog: () => "",
  });
  rd.compile = vi.fn((): Set<THREE.Material> => {
    rd.debug!.onShaderError!(gl, {} as never, {} as never, {} as never);
    return new Set();
  });
}

function armCompileOk(host: RenderHost): void {
  const rd = host.renderer as THREE.WebGLRenderer;
  rd.compile = vi.fn() as typeof rd.compile;
}

function sceneHarness(tileId = "pane-a"): {
  host: RenderHost;
  wall: HTMLElement;
  pane: HTMLElement;
  scene: NetScene;
} {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 640 });
  Object.defineProperty(wall, "clientHeight", { value: 480 });
  const pane = document.createElement("div");
  Object.defineProperty(pane, "clientWidth", { value: 320 });
  Object.defineProperty(pane, "clientHeight", { value: 240 });
  wall.appendChild(pane);
  document.body.appendChild(wall);
  const host = new RenderHost(wall);
  Object.defineProperty(host, "software", { value: false });
  const scene = new NetScene(pane, { satellite: true, host, tileId });
  return { host, wall, pane, scene };
}

describe("shader fallback net scene", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("scene-mounts-fallback", () => {
    const { host, wall, pane, scene } = sceneHarness();
    armCompileFail(host);
    const err = scene.setPluginShader(
      { id: "bad", source: OK },
      { packId: "bad", packName: "Bad Pack", packKey: "bad:1" },
    );
    expect(err).toBe("shader failed");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    expect(pane.querySelector(".tile-shader-fallback__text")?.textContent).toBe(
      genericShaderFallbackMessage("Bad Pack"),
    );
    host.dispose();
    wall.remove();
  });

  it("scene-clear-on-ok", () => {
    const { host, wall, pane, scene } = sceneHarness();
    armCompileFail(host);
    scene.setPluginShader(
      { id: "bad", source: OK },
      { packId: "bad", packName: "Bad Pack", packKey: "p:1" },
    );
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    armCompileOk(host);
    scene.setPluginShader(
      { id: "bad", source: OK },
      { packId: "bad", packName: "Bad Pack", packKey: "p:1" },
    );
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("scene-clear-on-null", () => {
    const { host, wall, pane, scene } = sceneHarness();
    armCompileFail(host);
    scene.setPluginShader(
      { id: "bad", source: OK },
      { packId: "bad", packName: "Bad Pack", packKey: "bad:1" },
    );
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    scene.setPluginShader(null);
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });

  it("scene-probe-wired", () => {
    const { host, wall, pane, scene } = sceneHarness();
    armCompileFail(host, "shader failed");
    const err = scene.setPluginShader(
      { id: "bad", source: OK },
      { packId: "bad", packName: "Bad Pack", packKey: "bad:1" },
    );
    expect(err).toBe("shader failed");
    expect(pane.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    host.dispose();
    wall.remove();
  });

  it("scene-begin-pack", () => {
    const { host, wall, pane, scene } = sceneHarness();
    armCompileOk(host);
    const begin = vi.spyOn(host, "beginTilePack");
    scene.setPluginShader(
      { id: "demo", source: OK },
      { packId: "demo", packName: "Demo", packKey: "demo:1" },
    );
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith("pane-a", "demo:1", "demo", pane, "Demo", true);
    begin.mockRestore();
    host.dispose();
    wall.remove();
  });

  it("scene-tile-id", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { value: 320 });
    Object.defineProperty(pane, "clientHeight", { value: 240 });
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const keyed = new NetScene(pane, { satellite: true, host, tileId: "pane-a" });
    expect(keyed.tileId).toBe("pane-a");
    const solo = new NetScene(pane, { satellite: true, host });
    expect(solo.tileId).toBe("main");
    host.dispose();
    wall.remove();
  });
});
