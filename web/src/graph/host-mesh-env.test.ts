import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { mockPartial } from "../../test-support/mock-partial";
import { HOST_MESH_ENV_LOOK, HostMeshEnv } from "./host-mesh-env";
import { HostMeshLane } from "./host-mesh-lane";

type FakeRenderer = Pick<THREE.WebGLRenderer, "toneMapping" | "toneMappingExposure" | "outputColorSpace"> & {
  isWebGLRenderer: true;
};

function fakeRenderer(): FakeRenderer {
  return {
    isWebGLRenderer: true,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.LinearSRGBColorSpace,
  };
}

const camera = new THREE.PerspectiveCamera();
const geometry = new THREE.BufferGeometry();
const material = new THREE.MeshBasicMaterial();
const group = new THREE.Group();

/** What WebGLRenderer.render does around a scene: onBeforeRender, draw, onAfterRender. */
function draw(scene: THREE.Scene, renderer: FakeRenderer, inner?: () => void): void {
  const r = mockPartial<THREE.WebGLRenderer>(renderer);
  scene.onBeforeRender(r, scene, camera, geometry, material, group);
  inner?.();
  scene.onAfterRender(r, scene, camera, geometry, material, group);
}

function rig() {
  const scene = new THREE.Scene();
  const anchor = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.8);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(anchor, hemi);
  anchor.add(sun);
  const tex = new THREE.Texture();
  const texDispose = vi.spyOn(tex, "dispose");
  const loader = vi.fn(async (_url: string) => tex);
  const target = new THREE.WebGLRenderTarget(4, 4);
  const targetDispose = vi.spyOn(target, "dispose");
  const build = vi.spyOn(THREE.PMREMGenerator.prototype, "fromEquirectangular").mockReturnValue(target);
  const env = new HostMeshEnv(anchor, loader);
  return { scene, anchor, hemi, sun, tex, texDispose, loader, target, targetDispose, build, env };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HostMeshEnv", () => {
  it("loads an sRGB equirect and builds the PMREM once, on the first draw", async () => {
    const { scene, tex, loader, build, env } = rig();
    expect(await env.load("/api/plugins/koi-pond/asset/env-hd.jpg")).toBe(true);
    expect(loader).toHaveBeenCalledWith("/api/plugins/koi-pond/asset/env-hd.jpg");
    expect(tex.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(env.active()).toBe(true);
    expect(build).not.toHaveBeenCalled();
    const renderer = fakeRenderer();
    draw(scene, renderer);
    draw(scene, renderer);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(tex);
  });

  it("tone maps with Neutral (hue-preserving), not ACES", () => {
    expect(HOST_MESH_ENV_LOOK.toneMapping).toBe(THREE.NeutralToneMapping);
  });

  it("lights the scene only while it draws, then puts the shared renderer and lights back", async () => {
    const { scene, hemi, sun, target, env } = rig();
    await env.load("env.jpg");
    const renderer = fakeRenderer();
    let during: Record<string, unknown> = {};
    draw(scene, renderer, () => {
      during = {
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        colorSpace: renderer.outputColorSpace,
        environment: scene.environment,
        hemi: hemi.intensity,
        sun: sun.intensity,
      };
    });
    expect(during).toEqual({
      toneMapping: HOST_MESH_ENV_LOOK.toneMapping,
      exposure: HOST_MESH_ENV_LOOK.exposure,
      colorSpace: THREE.SRGBColorSpace,
      environment: target.texture,
      hemi: 0.8 * HOST_MESH_ENV_LOOK.lightScale,
      sun: 2 * HOST_MESH_ENV_LOOK.lightScale,
    });
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
    expect(renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(scene.environment).toBeNull();
    expect(hemi.intensity).toBe(0.8);
    expect(sun.intensity).toBe(2);
  });

  it("a nested draw of the same scene (water reflector) neither re-applies nor restores early", async () => {
    const { scene, sun, env } = rig();
    await env.load("env.jpg");
    const renderer = fakeRenderer();
    let afterInner = -1;
    draw(scene, renderer, () => {
      draw(scene, renderer);
      afterInner = sun.intensity;
    });
    expect(afterInner).toBe(2 * HOST_MESH_ENV_LOOK.lightScale);
    expect(sun.intensity).toBe(2);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  });

  it("clear frees the PMREM and source and unhooks the scene", async () => {
    const { scene, texDispose, target, targetDispose, env } = rig();
    const before = scene.onBeforeRender;
    const after = scene.onAfterRender;
    await env.load("env.jpg");
    expect(scene.onBeforeRender).not.toBe(before);
    draw(scene, fakeRenderer());
    expect(env.envTarget()).toBe(target);
    texDispose.mockClear();
    env.clear();
    expect(targetDispose).toHaveBeenCalledTimes(1);
    expect(texDispose).toHaveBeenCalledTimes(1);
    expect(env.envTarget()).toBeNull();
    expect(env.active()).toBe(false);
    expect(scene.onBeforeRender).toBe(before);
    expect(scene.onAfterRender).toBe(after);
    expect(scene.userData.zotoHostMeshEnv).toBeUndefined();
  });

  it("rebuilding for another renderer frees the first PMREM", async () => {
    const { scene, target, targetDispose, build, env } = rig();
    await env.load("env.jpg");
    draw(scene, fakeRenderer());
    const second = new THREE.WebGLRenderTarget(4, 4);
    build.mockReturnValue(second);
    draw(scene, fakeRenderer());
    expect(build).toHaveBeenCalledTimes(2);
    expect(targetDispose).toHaveBeenCalledTimes(1);
    expect(env.envTarget()).toBe(second);
    expect(env.envTarget()).not.toBe(target);
  });

  it("a context restore on the same renderer frees the old PMREM and rebuilds it from the kept image", async () => {
    const { scene, tex, target, targetDispose, build, env } = rig();
    await env.load("env.jpg");
    const renderer = fakeRenderer();
    draw(scene, renderer);
    expect(build).toHaveBeenCalledTimes(1);
    env.contextRestored();
    expect(targetDispose).toHaveBeenCalledTimes(1);
    expect(env.envTarget()).toBeNull();
    expect(env.active()).toBe(true);
    const rebuilt = new THREE.WebGLRenderTarget(4, 4);
    build.mockReturnValue(rebuilt);
    let during: THREE.Texture | null = null;
    draw(scene, renderer, () => { during = scene.environment; });
    expect(build).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenLastCalledWith(tex);
    expect(env.envTarget()).toBe(rebuilt);
    expect(during).toBe(rebuilt.texture);
    expect(during).not.toBe(target.texture);
    draw(scene, renderer);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("a context restore with no environment loaded is a no-op", () => {
    const { build, targetDispose, env } = rig();
    env.contextRestored();
    expect(env.envTarget()).toBeNull();
    expect(build).not.toHaveBeenCalled();
    expect(targetDispose).not.toHaveBeenCalled();
  });

  it("drops a load that a clear overtook, and leaves no hooks", async () => {
    const { scene, tex, texDispose, env } = rig();
    let resolve!: (t: THREE.Texture) => void;
    const slow = new HostMeshEnv(scene.children[0]!, () => new Promise((r) => { resolve = r; }));
    const before = scene.onBeforeRender;
    const pending = slow.load("env.jpg");
    slow.clear();
    resolve(tex);
    expect(await pending).toBe(false);
    expect(texDispose).toHaveBeenCalled();
    expect(scene.onBeforeRender).toBe(before);
    expect(env.active()).toBe(false);
  });

  it("a failed load leaves the scene untouched", async () => {
    const scene = new THREE.Scene();
    const anchor = new THREE.Group();
    scene.add(anchor);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = scene.onBeforeRender;
    const env = new HostMeshEnv(anchor, () => Promise.reject(new Error("404")));
    expect(await env.load("missing.jpg")).toBe(false);
    expect(scene.onBeforeRender).toBe(before);
    expect(warn).toHaveBeenCalled();
  });
});

describe("HostMeshLane environment", () => {
  it("setEnvironment loads the pack asset URL (sha-pinned) and null turns it off", async () => {
    const lane = new HostMeshLane();
    const load = vi.spyOn(lane.env, "load").mockResolvedValue(true);
    const clear = vi.spyOn(lane.env, "clear");
    await lane.setEnvironment("koi-pond", { id: "env-hd", path: "assets/env-hd.jpg", sha256: "ab", role: "environment" });
    expect(load).toHaveBeenCalledWith("/api/plugins/koi-pond/asset/env-hd.jpg?h=ab");
    expect(await lane.setEnvironment("koi-pond", null)).toBe(false);
    expect(clear).toHaveBeenCalled();
  });

  it("lane.clear() (view switch, pane rebind, pane dispose) frees the environment", () => {
    const lane = new HostMeshLane();
    const clear = vi.spyOn(lane.env, "clear");
    lane.clear();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("lane.contextRestored() invalidates the environment PMREM", () => {
    const lane = new HostMeshLane();
    const restored = vi.spyOn(lane.env, "contextRestored");
    lane.contextRestored();
    expect(restored).toHaveBeenCalledTimes(1);
  });
});
