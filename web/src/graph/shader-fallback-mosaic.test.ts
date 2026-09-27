import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetScene } from "./scene";
import { RenderHost } from "./render-host";
import { mosaicSceneOpts } from "./mosaic";
import { failCompileWith } from "./shader-fallback-test-helpers";

const OK = `
void main() {
  fragColor = vec4(1.0);
}
`;

describe("shader fallback mosaic tiles", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("mosaic-tile-keyed", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const paneT1 = document.createElement("div");
    const paneT2 = document.createElement("div");
    for (const p of [paneT1, paneT2]) {
      Object.defineProperty(p, "clientWidth", { value: 300 });
      Object.defineProperty(p, "clientHeight", { value: 200 });
      wall.appendChild(p);
    }
    document.body.appendChild(wall);
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
    const s1 = new NetScene(paneT1, mosaicSceneOpts("t1", host));
    const s2 = new NetScene(paneT2, mosaicSceneOpts("t2", host));
    s1.setPluginShader(
      { id: "bad", source: OK },
      { packId: "bad", packName: "Bad", packKey: "bad:1" },
    );
    failCompileWith(host, "t1", s1.scene, s1.camera, { shaderLog: "err" });
    expect(paneT1.querySelectorAll(".tile-shader-fallback").length).toBe(1);
    expect(paneT2.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    rd.compile = vi.fn() as typeof rd.compile;
    s2.setPluginShader(
      { id: "good", source: OK },
      { packId: "good", packName: "Good", packKey: "good:1" },
    );
    expect(paneT2.querySelectorAll(".tile-shader-fallback").length).toBe(0);
    host.dispose();
    wall.remove();
  });
});
