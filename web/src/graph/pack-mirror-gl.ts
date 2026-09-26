import * as THREE from "three";
import type { SurfaceLetterboxFill } from "./letterbox-fill";
import { letterboxFillHex, letterboxInnerRectInto, paintLetterboxBars } from "./letterbox-fill";
import type { WebGLRenderer } from "three";

export type MirrorRect = { x: number; y: number; w: number; h: number };

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

export const PACK_MSAA_SAMPLES = 4;

export type LetterboxBarScratch = [MirrorRect, MirrorRect, MirrorRect, MirrorRect];

/** Counting hooks for lifecycle tests (no timing). */
export const packMirrorResourceStats = {
  renderTargetCreated: 0,
  renderTargetSetSize: 0,
  renderTargetDisposed: 0,
  presenterCreated: 0,
  textureCreated: 0,
  textureDisposed: 0,
  geometryDisposed: 0,
  materialDisposed: 0,
  reset(): void {
    this.renderTargetCreated = 0;
    this.renderTargetSetSize = 0;
    this.renderTargetDisposed = 0;
    this.presenterCreated = 0;
    this.textureCreated = 0;
    this.textureDisposed = 0;
    this.geometryDisposed = 0;
    this.materialDisposed = 0;
  },
};

/** Letterbox bars via scissored clears (CSS-pixel coords; renderer applies DPR). */
export function paintLetterboxBarsThree(
  renderer: MirrorRenderer,
  fill: SurfaceLetterboxFill,
  box: MirrorRect,
  inner: MirrorRect,
  bars: LetterboxBarScratch,
): void {
  const hex = letterboxFillHex(fill);
  renderer.setScissorTest(true);
  renderer.setClearColor(hex, 1);
  bars[0].x = box.x;
  bars[0].y = inner.y + inner.h;
  bars[0].w = box.w;
  bars[0].h = Math.max(0, box.y + box.h - inner.y - inner.h);
  bars[1].x = box.x;
  bars[1].y = box.y;
  bars[1].w = box.w;
  bars[1].h = Math.max(0, inner.y - box.y);
  bars[2].x = box.x;
  bars[2].y = inner.y;
  bars[2].w = Math.max(0, inner.x - box.x);
  bars[2].h = inner.h;
  bars[3].x = inner.x + inner.w;
  bars[3].y = inner.y;
  bars[3].w = Math.max(0, box.x + box.w - inner.x - inner.w);
  bars[3].h = inner.h;
  for (const b of bars) {
    if (b.w < 1 || b.h < 1) continue;
    renderer.setViewport(b.x, b.y, b.w, b.h);
    renderer.setScissor(b.x, b.y, b.w, b.h);
    renderer.clear(true, false, false);
  }
}

/** Quad presenter: geometry, material, camera, and scene built once per mirror. */
export class PackTexturePresenter {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly geometry = new THREE.PlaneGeometry(2, 2);
  readonly material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  readonly mesh: THREE.Mesh;
  readonly scratch = {
    innerTd: { x: 0, y: 0, w: 0, h: 0 },
    innerAbs: { x: 0, y: 0, w: 0, h: 0 },
    out: { x: 0, y: 0, w: 0, h: 0 },
    bars: [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ] as LetterboxBarScratch,
  };

  constructor() {
    packMirrorResourceStats.presenterCreated += 1;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);
  }

  dispose(): void {
    this.material.dispose();
    this.geometry.dispose();
    packMirrorResourceStats.materialDisposed += 1;
    packMirrorResourceStats.geometryDisposed += 1;
  }

  draw(
    renderer: MirrorRenderer,
    texture: THREE.Texture,
    dst: MirrorRect,
    fill: SurfaceLetterboxFill | null,
    contentAspect: number,
    opts: { letterbox: boolean },
  ): MirrorRect {
    const innerTd = this.scratch.innerTd;
    if (opts.letterbox) {
      letterboxInnerRectInto(dst, contentAspect, innerTd);
    } else {
      innerTd.x = 0;
      innerTd.y = 0;
      innerTd.w = dst.w;
      innerTd.h = dst.h;
    }
    const ix = dst.x + innerTd.x;
    const iy = dst.y + (dst.h - innerTd.y - innerTd.h);
    const iw = innerTd.w;
    const ih = innerTd.h;
    const innerAbs = this.scratch.innerAbs;
    innerAbs.x = ix;
    innerAbs.y = iy;
    innerAbs.w = iw;
    innerAbs.h = ih;
    if (fill && opts.letterbox) {
      paintLetterboxBarsThree(renderer, fill, dst, innerAbs, this.scratch.bars);
    }
    if (this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }
    renderer.setScissorTest(true);
    renderer.setViewport(ix, iy, iw, ih);
    renderer.setScissor(ix, iy, iw, ih);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    const out = this.scratch.out;
    out.x = ix;
    out.y = iy;
    out.w = iw;
    out.h = ih;
    return out;
  }
}

export type PackMirrorScope = {
  tileCount: number;
  antialias: boolean;
};

/** One capture RT + one quad presenter per duplicated pack (created when scope opens). */
export class PackMirrorSession {
  private rt: THREE.WebGLRenderTarget | null = null;
  private pw = 0;
  private ph = 0;
  private samples = -1;
  readonly presenter = new PackTexturePresenter();
  rendered = false;

  get target(): THREE.WebGLRenderTarget | null { return this.rt; }

  dispose(): void {
    if (this.rt) {
      this.rt.dispose();
      packMirrorResourceStats.renderTargetDisposed += 1;
    }
    this.rt = null;
    this.pw = 0;
    this.ph = 0;
    this.samples = -1;
    this.rendered = false;
    this.presenter.dispose();
  }

  ensure(pw: number, ph: number, antialias: boolean): THREE.WebGLRenderTarget | null {
    if (pw < 2 || ph < 2) return null;
    const samples = antialias ? PACK_MSAA_SAMPLES : 0;
    if (!this.rt) {
      this.pw = pw;
      this.ph = ph;
      this.samples = samples;
      this.rt = new THREE.WebGLRenderTarget(pw, ph, {
        depthBuffer: true,
        stencilBuffer: false,
        samples,
      });
      packMirrorResourceStats.renderTargetCreated += 1;
      return this.rt;
    }
    if (samples !== this.samples) {
      this.rt.dispose();
      packMirrorResourceStats.renderTargetDisposed += 1;
      this.samples = samples;
      this.rt = new THREE.WebGLRenderTarget(pw, ph, {
        depthBuffer: true,
        stencilBuffer: false,
        samples,
      });
      packMirrorResourceStats.renderTargetCreated += 1;
      this.pw = pw;
      this.ph = ph;
      return this.rt;
    }
    if (pw !== this.pw || ph !== this.ph) {
      this.rt.setSize(pw, ph);
      packMirrorResourceStats.renderTargetSetSize += 1;
      this.pw = pw;
      this.ph = ph;
    }
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
    const rd = renderer as THREE.WebGLRenderer;
    const prev = rd.getRenderTarget?.() ?? null;
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
  allocationCount = 0;

  beginFrame(): void {
    for (const s of this.sessions.values()) s.rendered = false;
  }

  /** Allocate / free mirrors only when tile count crosses 2 for a pack key. */
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
    dst: MirrorRect,
    opts: { letterbox: boolean; fill: SurfaceLetterboxFill | null; aspect: number },
  ): MirrorRect | null {
    const session = this.sessions.get(key);
    const rt = session?.target;
    if (!rt || !session?.rendered) return null;
    return session.presenter.draw(renderer, rt.texture, dst, opts.fill, opts.aspect, {
      letterbox: opts.letterbox,
    });
  }

  dispose(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}

/** Readback harness only: sandbox GPU mirror path without the publish lane. */
export class SandboxBitmapGl {
  private texture: THREE.Texture | null = null;
  private tw = 0;
  private th = 0;
  readonly presenter = new PackTexturePresenter();
  uploadCount = 0;

  dispose(): void {
    if (this.texture) {
      this.texture.dispose();
      packMirrorResourceStats.textureDisposed += 1;
    }
    this.texture = null;
    this.tw = 0;
    this.th = 0;
    this.presenter.dispose();
  }

  ensureTexture(w: number, h: number): THREE.Texture | null {
    if (w < 2 || h < 2) return null;
    if (this.texture && w === this.tw && h === this.th) return this.texture;
    if (this.texture) {
      this.texture.dispose();
      packMirrorResourceStats.textureDisposed += 1;
    }
    this.tw = w;
    this.th = h;
    this.texture = new THREE.Texture();
    packMirrorResourceStats.textureCreated += 1;
    this.texture.flipY = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    return this.texture;
  }

  uploadFrame(bitmap: ImageBitmap): THREE.Texture | null {
    const tex = this.ensureTexture(bitmap.width, bitmap.height);
    if (!tex) return null;
    tex.image = bitmap;
    tex.needsUpdate = true;
    this.uploadCount += 1;
    return tex;
  }

  present(
    renderer: MirrorRenderer,
    texture: THREE.Texture,
    fill: SurfaceLetterboxFill,
    dst: MirrorRect,
    aspect: number,
  ): MirrorRect {
    return this.presenter.draw(renderer, texture, dst, fill, aspect, { letterbox: true });
  }
}

