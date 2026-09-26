import * as THREE from "three";
import type { SurfaceLetterboxFill } from "./letterbox-fill";
import { letterboxFillHex, letterboxInnerRect, paintLetterboxBars } from "./letterbox-fill";
import type { WebGLRenderer } from "three";

export type MirrorRenderer = Pick<
  WebGLRenderer,
  | "setScissorTest"
  | "setViewport"
  | "setScissor"
  | "setClearColor"
  | "clear"
  | "getPixelRatio"
  | "setRenderTarget"
  | "render"
  | "getContext"
>;

const PACK_MSAA_SAMPLES = 4;

/** Letterbox bars via scissored clears (CSS-pixel coords; renderer applies DPR). */
export function paintLetterboxBarsThree(
  renderer: MirrorRenderer,
  fill: SurfaceLetterboxFill,
  box: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
): void {
  const hex = letterboxFillHex(fill);
  renderer.setScissorTest(true);
  renderer.setClearColor(hex, 1);
  const bars = [
    { x: box.x, y: box.y, w: box.w, h: Math.max(0, inner.y - box.y) },
    { x: box.x, y: inner.y + inner.h, w: box.w, h: Math.max(0, box.y + box.h - inner.y - inner.h) },
    { x: box.x, y: inner.y, w: Math.max(0, inner.x - box.x), h: inner.h },
    { x: inner.x + inner.w, y: inner.y, w: Math.max(0, box.x + box.w - inner.x - inner.w), h: inner.h },
  ];
  for (const b of bars) {
    if (b.w < 1 || b.h < 1) continue;
    renderer.setViewport(b.x, b.y, b.w, b.h);
    renderer.setScissor(b.x, b.y, b.w, b.h);
    renderer.clear(true, false, false);
  }
}

/** Draw a texture into a tile viewport (CSS pixels). */
export class PackTexturePresenter {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  constructor() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }

  draw(
    renderer: MirrorRenderer,
    texture: THREE.Texture,
    dst: { x: number; y: number; w: number; h: number },
    fill: SurfaceLetterboxFill | null,
    contentAspect: number,
    opts: { letterbox: boolean; flipY?: boolean },
  ): { x: number; y: number; w: number; h: number } {
    const inner = opts.letterbox ? letterboxInnerRect(dst, contentAspect) : { x: 0, y: 0, w: dst.w, h: dst.h };
    const ix = dst.x + inner.x;
    const iy = dst.y + inner.y;
    const iw = inner.w;
    const ih = inner.h;
    if (fill && opts.letterbox) {
      const innerAbs = { x: ix, y: iy, w: iw, h: ih };
      paintLetterboxBarsThree(renderer, fill, dst, innerAbs);
    }
    texture.flipY = opts.flipY ?? false;
    this.material.map = texture;
    this.material.needsUpdate = true;
    renderer.setScissorTest(true);
    renderer.setViewport(ix, iy, iw, ih);
    renderer.setScissor(ix, iy, iw, ih);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    return { x: ix, y: iy, w: iw, h: ih };
  }
}

export type PackMirrorScope = {
  tileCount: number;
  antialias: boolean;
};

/** One WebGLRenderTarget capture per duplicated pack group. */
export class PackMirrorSession {
  private rt: THREE.WebGLRenderTarget | null = null;
  get target(): THREE.WebGLRenderTarget | null { return this.rt; }
  private pw = 0;
  private ph = 0;
  private samples = 0;
  rendered = false;

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.pw = 0;
    this.ph = 0;
    this.rendered = false;
  }

  ensure(pw: number, ph: number, antialias: boolean): THREE.WebGLRenderTarget | null {
    if (pw < 2 || ph < 2) return null;
    const samples = antialias ? PACK_MSAA_SAMPLES : 0;
    if (this.rt && pw === this.pw && ph === this.ph && samples === this.samples) return this.rt;
    this.dispose();
    this.pw = pw;
    this.ph = ph;
    this.samples = samples;
    this.rt = new THREE.WebGLRenderTarget(pw, ph, {
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
    return this.rt;
  }

  renderPack(
    renderer: MirrorRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    pw: number,
    ph: number,
    clearHex: number,
    antialias: boolean,
  ): THREE.Texture | null {
    const rt = this.ensure(pw, ph, antialias);
    if (!rt) return null;
    const prev = (renderer as THREE.WebGLRenderer).getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.setViewport(0, 0, pw, ph);
    renderer.setScissor(0, 0, pw, ph);
    renderer.setScissorTest(true);
    renderer.setClearColor(clearHex, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    this.rendered = true;
    return rt.texture;
  }
}

export class PackMirrorRegistry {
  private readonly sessions = new Map<string, PackMirrorSession>();
  private readonly presenter = new PackTexturePresenter();
  allocationCount = 0;

  beginFrame(): void {
    for (const s of this.sessions.values()) s.rendered = false;
  }

  /** Allocate / free targets only when tile count crosses 2 for a pack key. */
  syncScopes(scopes: ReadonlyMap<string, PackMirrorScope>): void {
    for (const [key, session] of this.sessions) {
      if ((scopes.get(key)?.tileCount ?? 0) < 2) {
        session.dispose();
        this.sessions.delete(key);
      }
    }
    for (const [key, scope] of scopes) {
      if (scope.tileCount < 2) continue;
      if (!this.sessions.has(key)) {
        this.sessions.set(key, new PackMirrorSession());
        this.allocationCount += 1;
      }
    }
  }

  sessionFor(key: string): PackMirrorSession | undefined {
    return this.sessions.get(key);
  }

  renderPrimary(
    key: string,
    renderer: MirrorRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    box: { w: number; h: number },
    clearHex: number,
    antialias: boolean,
  ): THREE.Texture | null {
    const session = this.sessions.get(key);
    if (!session) return null;
    const pr = renderer.getPixelRatio();
    const pw = Math.max(2, Math.round(box.w * pr));
    const ph = Math.max(2, Math.round(box.h * pr));
    return session.renderPack(renderer, scene, camera, pw, ph, clearHex, antialias);
  }

  presentPack(
    key: string,
    renderer: MirrorRenderer,
    dst: { x: number; y: number; w: number; h: number },
    opts: { letterbox: boolean; fill: SurfaceLetterboxFill | null; aspect: number; flipY?: boolean },
  ): { x: number; y: number; w: number; h: number } | null {
    const session = this.sessions.get(key);
    const rt = session?.target;
    if (!rt || !session.rendered) return null;
    return this.presenter.draw(renderer, rt.texture, dst, opts.fill, opts.aspect, {
      letterbox: opts.letterbox,
      flipY: opts.flipY,
    });
  }

  dispose(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.presenter.dispose();
  }
}

/** Sandbox duplicate: one GPU texture per plugin id, uploaded each frame. */
export class SandboxBitmapGl {
  private texture: THREE.Texture | null = null;
  private tw = 0;
  private th = 0;
  uploadCount = 0;

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.tw = 0;
    this.th = 0;
  }

  ensureTexture(w: number, h: number): THREE.Texture | null {
    if (w < 2 || h < 2) return null;
    if (this.texture && w === this.tw && h === this.th) return this.texture;
    this.texture?.dispose();
    this.tw = w;
    this.th = h;
    this.texture = new THREE.Texture();
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    return this.texture;
  }

  uploadFrame(bitmap: ImageBitmap): THREE.Texture | null {
    const tex = this.ensureTexture(bitmap.width, bitmap.height);
    if (!tex) return null;
    tex.image = bitmap;
    tex.flipY = true;
    tex.needsUpdate = true;
    this.uploadCount += 1;
    return tex;
  }

  present(
    presenter: PackTexturePresenter,
    renderer: MirrorRenderer,
    texture: THREE.Texture,
    fill: SurfaceLetterboxFill,
    dst: { x: number; y: number; w: number; h: number },
    aspect: number,
  ): { x: number; y: number; w: number; h: number } {
    return presenter.draw(renderer, texture, dst, fill, aspect, { letterbox: true, flipY: false });
  }
}

const sandboxGpu = new Map<string, SandboxBitmapGl>();
const sharedPresenter = new PackTexturePresenter();

export function sandboxBitmapGl(pluginId: string): SandboxBitmapGl {
  let gpu = sandboxGpu.get(pluginId);
  if (!gpu) {
    gpu = new SandboxBitmapGl();
    sandboxGpu.set(pluginId, gpu);
  }
  return gpu;
}

export function sandboxBitmapPresenter(): PackTexturePresenter {
  return sharedPresenter;
}

export function resetSandboxBitmapGl(): void {
  for (const gpu of sandboxGpu.values()) gpu.dispose();
  sandboxGpu.clear();
}

export function teardownSandboxBitmapGl(pluginId: string): void {
  const gpu = sandboxGpu.get(pluginId);
  if (gpu) {
    gpu.dispose();
    sandboxGpu.delete(pluginId);
  }
}
