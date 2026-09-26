import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";
import { Backdrop } from "./backdrop";

const OK = `void main() { fragColor = vec4(1.0); }`;

describe("tile shader compile latch", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  function wallHost(): { host: RenderHost; wall: HTMLElement } {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    return { host, wall };
  }

  it("compile-once", () => {
    const { host, wall } = wallHost();
    const rd = host.renderer as THREE.WebGLRenderer;
    const compile = vi.fn();
    rd.compile = compile as typeof rd.compile;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const log = vi.fn();
    host.compilePluginSky("pane-a", scene, camera, log);
    for (let i = 0; i < 599; i++) host.compilePluginSky("pane-a", scene, camera, log);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(0);
    compile.mockRestore();
    host.dispose();
    wall.remove();
  });

  it("link-failure", () => {
    const { host, wall } = wallHost();
    const rd = host.renderer as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const log = vi.fn();
    const compile = vi.fn(() => {
      host.tileSlot("pane-b").latch.fail("link error", log);
    });
    rd.compile = compile as typeof rd.compile;
    host.compilePluginSky("pane-b", scene, camera, log);
    for (let i = 0; i < 599; i++) host.compilePluginSky("pane-b", scene, camera, log);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("link error");
    compile.mockRestore();
    host.dispose();
    wall.remove();
  });
});

describe("plugin sky one compile", () => {
  it("one-compile-per-shader", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    const rd = host.renderer as THREE.WebGLRenderer;
    const compile = vi.fn();
    rd.compile = compile as typeof rd.compile;
    const backdrop = new Backdrop();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(backdrop.mesh);
    const err = backdrop.setPluginShader({ id: "demo", source: OK }, () => {
      const ok = host.compilePluginSky("pane-a", scene, camera);
      return ok ? null : "shader failed";
    });
    expect(err).toBeNull();
    expect(compile).toHaveBeenCalledTimes(1);
    compile.mockRestore();
    host.dispose();
    wall.remove();
  });
});
