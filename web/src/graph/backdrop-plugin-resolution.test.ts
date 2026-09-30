/**
 * #180 H2: a pack sky's ``uResolution`` is the real drawing-buffer size, from the moment its
 * material is created and after every resize. It used to stay at the (16, 9) placeholder, so
 * resolution-driven packs (fluid-dyn) drew a flat wall.
 *
 * Revert row: drop the ``syncPluginHostUniforms()`` calls in ``Backdrop.ensurePluginMat`` -> every
 * row here reads 16x9 after mount.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Backdrop } from "./backdrop";
import { NetScene } from "./scene";
import { RenderHost } from "./render-host";

const OK_FRAG = `
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(dir * uResolution.x / max(uResolution.y, 1.0), uOpacity);
}
`;

function res(sky: Backdrop): [number, number] {
  const mat = sky.mesh.material as THREE.ShaderMaterial;
  const v = mat.uniforms.uResolution?.value as THREE.Vector2 | undefined;
  return v ? [v.x, v.y] : [NaN, NaN];
}

describe("#180 H2: pack sky uResolution tracks the drawing buffer", () => {
  it("viewport first, then the pack sky mounts: uResolution is the buffer size, and follows a resize", () => {
    const sky = new Backdrop();
    sky.setViewport(1280, 720, 2);
    sky.setKind("plugin");
    expect(sky.setPluginShader({ id: "fluid-dyn", source: OK_FRAG }, () => null)).toBeNull();
    expect(sky.pluginSkyId()).toBe("fluid-dyn");
    expect(res(sky), "after mount").toEqual([2560, 1440]);
    sky.setViewport(800, 600, 1.5);
    expect(res(sky), "after a resize").toEqual([1200, 900]);
  });

  it("shader compiled under another sky, resized, then shown: uResolution is the current buffer size", () => {
    const sky = new Backdrop();
    sky.setKind("aurora");
    sky.setViewport(640, 480, 1);
    expect(sky.setPluginShader({ id: "fluid-dyn", source: OK_FRAG }, () => null)).toBeNull();
    expect(sky.pluginSkyId(), "not bound outside plugin kind").toBeNull();
    sky.setViewport(1024, 768, 2);
    sky.setKind("plugin");
    expect(sky.pluginSkyId()).toBe("fluid-dyn");
    expect(res(sky), "after it is shown").toEqual([2048, 1536]);
    sky.setViewport(1920, 1080, 1);
    expect(res(sky), "after a resize").toEqual([1920, 1080]);
  });

  it("through a NetScene pane: the pane's drawing-buffer size after mount and after a resize", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const pane = document.createElement("div");
    let w = 320, h = 240;
    Object.defineProperty(pane, "clientWidth", { get: () => w, configurable: true });
    Object.defineProperty(pane, "clientHeight", { get: () => h, configurable: true });
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    Object.defineProperty(host, "software", { value: false });
    (host.renderer as THREE.WebGLRenderer).compile = vi.fn() as never;
    const scene = new NetScene(pane, { satellite: true, host, tileId: "pane-a" });
    try {
      const sky = (scene as unknown as { backdrop: Backdrop }).backdrop;
      const resize = () => (scene as unknown as { resize(): void }).resize();
      resize();
      sky.setKind("plugin");
      expect(scene.setPluginShader({ id: "fluid-dyn", source: OK_FRAG }, { packId: "fluid-dyn", packName: "Fluid", packKey: "fluid-dyn:1" })).toBeNull();
      expect(sky.pluginSkyId()).toBe("fluid-dyn");
      const pr = host.pixelRatio ?? 1;
      expect(res(sky), "after mount").toEqual([Math.floor(320 * pr), Math.floor(240 * pr)]);
      w = 500; h = 300;
      resize();
      expect(res(sky), "after a resize").toEqual([Math.floor(500 * pr), Math.floor(300 * pr)]);
    } finally {
      host.dispose();
      wall.remove();
    }
  });
});
