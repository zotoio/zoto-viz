import * as THREE from "three";

/** `role` of a plugin.yml asset that is an equirect environment image, not a mesh. */
export const HOST_MESH_ENV_ROLE = "environment";

/**
 * How an HD environment lights the scene. The env map carries most of the light, so the scene's
 * own hemisphere/directional/point lights drop to `lightScale` while it is on (no double light).
 */
export type HostMeshEnvLook = {
  toneMapping: THREE.ToneMapping;
  exposure: number;
  envIntensity: number;
  lightScale: number;
};

export const HOST_MESH_ENV_LOOK: Readonly<HostMeshEnvLook> = {
  toneMapping: THREE.ACESFilmicToneMapping,
  exposure: 1.0,
  envIntensity: 0.6,
  lightScale: 0.8,
};

export type HostMeshEnvLoader = (url: string) => Promise<THREE.Texture>;

export function loadHostMeshEnvTexture(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url);
}

type RenderHook = THREE.Scene["onBeforeRender"];
type AfterHook = THREE.Scene["onAfterRender"];

type Saved = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  toneMapping: THREE.ToneMapping;
  exposure: number;
  colorSpace: THREE.WebGLRenderer["outputColorSpace"];
  environment: THREE.Texture | null;
  environmentIntensity: number;
  lights: [THREE.Light, number][];
};

function sceneOf(o: THREE.Object3D): THREE.Scene | null {
  let p: THREE.Object3D | null = o;
  while (p && !(p as THREE.Scene).isScene) p = p.parent;
  return (p as THREE.Scene | null) ?? null;
}

/**
 * Image-based lighting for one host-mesh lane. The pack's equirect image becomes a PMREM env map
 * that lights the lane's scene, with tone mapping and sRGB output, only while that scene renders:
 * mosaic panes share one WebGLRenderer, so renderer state and the scene's lights are set in
 * `scene.onBeforeRender` and put back in `onAfterRender`. The PMREM is built on first render
 * (that is where the renderer is) and freed by {@link clear}.
 */
export class HostMeshEnv {
  private source: THREE.Texture | null = null;
  private pmrem: THREE.WebGLRenderTarget | null = null;
  private builtFor: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private before: RenderHook | null = null;
  private after: AfterHook | null = null;
  private saved: Saved | null = null;
  /** Nested renders of the same scene (the koi water Reflector) see the state already applied. */
  private depth = 0;
  private epoch = 0;
  look: HostMeshEnvLook = { ...HOST_MESH_ENV_LOOK };

  constructor(
    private readonly anchor: THREE.Object3D,
    private readonly loadTexture: HostMeshEnvLoader = loadHostMeshEnvTexture,
  ) {}

  /** True once an image is loaded and hooked into the anchor's scene. */
  active(): boolean {
    return this.source !== null && this.scene !== null;
  }

  envTarget(): THREE.WebGLRenderTarget | null {
    return this.pmrem;
  }

  /** Load `url` and light the anchor's scene with it. Resolves false when superseded or failed. */
  async load(url: string): Promise<boolean> {
    this.clear();
    const epoch = this.epoch;
    let tex: THREE.Texture;
    try {
      tex = await this.loadTexture(url);
    } catch (e) {
      if (epoch === this.epoch) console.warn("zoto-viz host mesh: environment", url, e);
      return false;
    }
    if (epoch !== this.epoch) {
      tex.dispose();
      return false;
    }
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.name = tex.name || "host-mesh-env";
    this.source = tex;
    const scene = sceneOf(this.anchor);
    if (scene) this.attach(scene);
    return this.scene !== null;
  }

  /** Free the PMREM and source image, unhook the scene and drop any in-flight load. */
  clear(): void {
    this.epoch += 1;
    this.restore();
    this.detach();
    this.pmrem?.dispose();
    this.pmrem = null;
    this.builtFor = null;
    const src = this.source;
    this.source = null;
    if (src) {
      const image = src.image as { close?: () => void } | null;
      src.dispose();
      if (image && typeof image.close === "function") image.close();
    }
  }

  private attach(scene: THREE.Scene): void {
    this.scene = scene;
    const prevBefore = scene.onBeforeRender;
    const prevAfter = scene.onAfterRender;
    const before: RenderHook = (...args) => {
      prevBefore.apply(scene, args);
      if (this.scene === scene) this.apply(args[0]);
    };
    const after: AfterHook = (...args) => {
      if (this.scene === scene) this.unapply();
      prevAfter.apply(scene, args);
    };
    this.before = prevBefore;
    this.after = prevAfter;
    scene.onBeforeRender = before;
    scene.onAfterRender = after;
    (scene.userData as Record<string, unknown>).zotoHostMeshEnv = { before, after };
  }

  private detach(): void {
    const scene = this.scene;
    this.scene = null;
    if (!scene) return;
    const mine = (scene.userData as Record<string, unknown>).zotoHostMeshEnv as
      { before: RenderHook; after: AfterHook } | undefined;
    // Only unwrap when nothing re-wrapped the hooks after us; otherwise ours stays as a no-op.
    if (mine && scene.onBeforeRender === mine.before && this.before) scene.onBeforeRender = this.before;
    if (mine && scene.onAfterRender === mine.after && this.after) scene.onAfterRender = this.after;
    delete (scene.userData as Record<string, unknown>).zotoHostMeshEnv;
    this.before = null;
    this.after = null;
  }

  private ensurePmrem(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget | null {
    if (this.pmrem && this.builtFor === renderer) return this.pmrem;
    if (!this.source) return null;
    this.pmrem?.dispose();
    const gen = new THREE.PMREMGenerator(renderer);
    try {
      this.pmrem = gen.fromEquirectangular(this.source);
      this.builtFor = renderer;
    } finally {
      gen.dispose();
    }
    // The equirect only feeds the PMREM: drop its GPU copy, keep the image for a rebuild.
    this.source.dispose();
    return this.pmrem;
  }

  private apply(renderer: THREE.WebGLRenderer): void {
    if (this.depth++ > 0) return;
    const scene = this.scene;
    if (!scene || !(renderer as { isWebGLRenderer?: boolean }).isWebGLRenderer) return;
    const env = this.ensurePmrem(renderer);
    if (!env) return;
    const lights: [THREE.Light, number][] = [];
    scene.traverse((o) => {
      const light = o as THREE.Light;
      if (light.isLight) lights.push([light, light.intensity]);
    });
    this.saved = {
      renderer,
      scene,
      toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure,
      colorSpace: renderer.outputColorSpace,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
      lights,
    };
    const look = this.look;
    renderer.toneMapping = look.toneMapping;
    renderer.toneMappingExposure = look.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.environment = env.texture;
    scene.environmentIntensity = look.envIntensity;
    for (const [light, intensity] of lights) light.intensity = intensity * look.lightScale;
  }

  private unapply(): void {
    if (this.depth > 0) this.depth -= 1;
    if (this.depth > 0) return;
    this.restore();
  }

  private restore(): void {
    this.depth = 0;
    const saved = this.saved;
    this.saved = null;
    if (!saved) return;
    const { renderer, scene } = saved;
    renderer.toneMapping = saved.toneMapping;
    renderer.toneMappingExposure = saved.exposure;
    renderer.outputColorSpace = saved.colorSpace;
    scene.environment = saved.environment;
    scene.environmentIntensity = saved.environmentIntensity;
    for (const [light, intensity] of saved.lights) light.intensity = intensity;
  }
}
