import * as THREE from "three";
import type { SurfaceLetterboxFill } from "./letterbox-fill";
import { letterboxInnerRectInto } from "./letterbox-fill";
import type { WebGLRenderer } from "three";
import { packMirrorSizeStats } from "./pack-mirror-size-stats";
import {
  type CanvasDeviceHeight,
  type CssRect,
  type CssRectLoose,
  type DeviceRectMut,
  type GlRectMut,
  asCssRect,
  deviceSizeFromCssBoxInto,
  type DeviceSizeMut,
  asCanvasDeviceHeight,
} from "./pack-mirror-rect";
import { applyHostViewBoxToGlRenderer } from "./render-host-gl-adapter";

export type PackMirrorHostGl = {
  layoutPixelRatio: number;
  canvasCssHeight: number;
  canvasDeviceHeight: CanvasDeviceHeight;
};

/** @deprecated Use `CssRect` from `./pack-mirror-rect`. */
export type MirrorRect = CssRect;

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

export type LetterboxBarScratch = [CssRectLoose, CssRectLoose, CssRectLoose, CssRectLoose];

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
    packMirrorSizeStats.reset();
  },
};

const letterboxBarDeviceScratch: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
const letterboxBarGlScratch: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };

/** Letterbox bars via scissored clears (per-edge device rects; renderer pixel ratio must be 1). */
export function paintLetterboxBarsThree(
  renderer: MirrorRenderer,
  fill: SurfaceLetterboxFill,
  box: CssRect,
  inner: CssRect,
  bars: LetterboxBarScratch,
  hostGl: PackMirrorHostGl,
): void {
  const hex = fill.hex;
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
    applyHostViewBoxToGlRenderer(
      renderer,
      b,
      hostGl.canvasCssHeight,
      hostGl.layoutPixelRatio,
      hostGl.canvasDeviceHeight,
      letterboxBarDeviceScratch,
      letterboxBarGlScratch,
    );
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
    deviceVp: { x: 0, y: 0, w: 0, h: 0 },
    glVp: { x: 0, y: 0, w: 0, h: 0 },
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
    dst: CssRect,
    fill: SurfaceLetterboxFill | null,
    contentAspect: number,
    opts: { letterbox: boolean },
    hostGl: PackMirrorHostGl,
  ): CssRect {
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
      paintLetterboxBarsThree(renderer, fill, dst, asCssRect(innerAbs), this.scratch.bars, hostGl);
    }
    if (this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }
    applyHostViewBoxToGlRenderer(
      renderer,
      { x: ix, y: iy, w: iw, h: ih },
      hostGl.canvasCssHeight,
      hostGl.layoutPixelRatio,
      hostGl.canvasDeviceHeight,
      this.scratch.deviceVp,
      this.scratch.glVp,
    );
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    const out = this.scratch.out;
    out.x = ix;
    out.y = iy;
    out.w = iw;
    out.h = ih;
    return asCssRect(out);
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
  /** Last `deviceSize` reference passed to `renderPack` (lifecycle tests). */
  lastRenderDeviceSize: DeviceSizeMut | null = null;

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
    cssSize: CssRectLoose,
    deviceSize: DeviceSizeMut,
    clearHex: number,
    antialias: boolean,
  ): THREE.Texture | null {
    this.lastRenderDeviceSize = deviceSize;
    const rt = this.ensure(deviceSize.pw, deviceSize.ph, antialias);
    if (!rt) return null;
    const rd = renderer as THREE.WebGLRenderer;
    const prev = rd.getRenderTarget?.() ?? null;
    renderer.setRenderTarget(rt);
    renderer.setViewport(0, 0, deviceSize.pw, deviceSize.ph);
    renderer.setScissor(0, 0, deviceSize.pw, deviceSize.ph);
    renderer.setScissorTest(true);
    renderer.setClearColor(clearHex, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    rt.texture.flipY = true;
    this.rendered = true;
    return rt.texture;
  }
}

export class PackMirrorRegistry {
  private readonly sessions = new Map<string, PackMirrorSession>();
  allocationCount = 0;

  /** Reused for every `renderPrimary` (no per-frame `{pw,ph}` allocation). */
  readonly devicePackSizeScratch: DeviceSizeMut = { pw: 0, ph: 0 };

  private readonly drawLetterboxScratch = { letterbox: false };

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
    box: CssRectLoose,
    clearHex: number,
    antialias: boolean,
    hostGl: PackMirrorHostGl,
  ): THREE.Texture | null {
    const session = this.sessions.get(key);
    if (!session) return null;
    deviceSizeFromCssBoxInto(box, hostGl.layoutPixelRatio, this.devicePackSizeScratch);
    return session.renderPack(renderer, scene, camera, box, this.devicePackSizeScratch, clearHex, antialias);
  }

  presentPack(
    key: string,
    renderer: MirrorRenderer,
    dst: CssRect,
    opts: { letterbox: boolean; fill: SurfaceLetterboxFill | null; aspect: number },
    hostGl: PackMirrorHostGl,
  ): CssRect | null {
    const session = this.sessions.get(key);
    const rt = session?.target;
    if (!rt || !session?.rendered) return null;
    this.drawLetterboxScratch.letterbox = opts.letterbox;
    return session.presenter.draw(
      renderer,
      rt.texture,
      dst,
      opts.fill,
      opts.aspect,
      this.drawLetterboxScratch,
      hostGl,
    );
  }

  dispose(): void {
    this.sessions.forEach((s) => s.dispose());
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
    this.texture.flipY = true;
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
    dst: CssRect,
    aspect: number,
    hostGl?: PackMirrorHostGl,
  ): CssRect {
    const gl = hostGl ?? {
      layoutPixelRatio: 1,
      canvasCssHeight: dst.h,
      canvasDeviceHeight: asCanvasDeviceHeight(Math.max(1, dst.h)),
    };
    return this.presenter.draw(renderer, texture, dst, fill, aspect, { letterbox: true }, gl);
  }
}

