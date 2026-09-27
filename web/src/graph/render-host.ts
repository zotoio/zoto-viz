/**
 * One canvas for every graph pane.
 *
 * Each `NetScene` used to own a canvas and a `WebGLRenderer`; a 2×4 mosaic meant eight contexts,
 * eight swap chains and eight rAF callbacks per vsync. The host owns a single canvas that covers
 * `#wall`, sits behind the panes (which are transparent where a hosted scene lives), and draws every
 * registered view into its own scissored viewport from one animation loop. Views keep their own
 * `THREE.Scene`, camera, label layer and input element — the pane's container — so pointer handling
 * and layout are untouched.
 *
 * When WebGL is unavailable (Cursor / Electron Simple Browser disables the GPU), the same canvas is
 * 2D and each view paints through `paintSoftware`.
 *
 * The canvas is `alpha: true` and cleared to transparent only when the layout changes, so the
 * wall's CSS background shows through the 1px grid gaps; inside a viewport the view's own clear
 * colour is opaque.
 */

import * as THREE from "three";
import type { SoftRect } from "./software-draw";
import { cssHex } from "./software-draw";
import { letterboxFillHex, letterboxInnerRect, paintLetterboxBars, type SurfaceLetterboxFill } from "./letterbox-fill";
import { probeWebGL } from "./webgl";
import { observeResize } from "../core/resize";
import { harvestGpu, timeGpu } from "../core/gpu-time";
import { finishSandboxBitmapHostFrame, paintPackMirrorPlaceholder } from "../plugins/sandbox-bitmap";
import {
  PackMirrorRegistry,
  paintLetterboxBarsThree,
  resetSandboxBitmapGl,
  sandboxBitmapGl,
  syncSandboxBitmapGpuScopes,
  type LetterboxBarScratch,
} from "./pack-mirror-gl";
import {
  type CssRect,
  type CssRectLoose,
  type DeviceRect,
  type DeviceRectMut,
  asCssRect,
  cssRectTopFromBottomLeft,
  toDeviceRectInto,
} from "./pack-mirror-rect";
import { renderHostMirrorTelemetry } from "./render-host-telemetry";

type PackMirrorViewMeta = HostedView & {
  packCoalesceGroupKey?: string;
  isPackMirrorPrimary?: boolean;
  packCoalesceTileCount?: number;
  packSandboxMirrorPluginId?: string;
};

function packMirrorMeta(view: HostedView): PackMirrorViewMeta {
  return view as PackMirrorViewMeta;
}
import { frameTsFromRaf } from "../core/time-ms";
import type { FrameTs } from "../core/time-ms";

export interface HostedView {
  /** element whose box on the page is this view's viewport */
  readonly viewEl: HTMLElement;
  /** update and draw one frame; call `host.present(...)` from inside */
  hostFrame(ts: FrameTs): void;
  hostContextLost(): void;
  hostContextRestored(): void;
  /** Canvas 2D fallback when `host.software` is set */
  paintSoftware?(ctx: CanvasRenderingContext2D, rect: SoftRect): void;
  /** GPU milliseconds for this pane's last draw, once the timer query resolves. */
  noteFrameCost?(ms: number): void;
}

/** Framebuffer pixels, origin bottom-left (what `gl.readPixels` wants). */
export type Viewport = DeviceRect;

/**
 * Canvas backing-store pixels (`canvas.width` / `canvas.height`), not CSS layout.
 * Sized from the wall viewport × devicePixelRatio, capped at 1.5× for stability.
 */
export interface DevicePixelSize {
  w: number;
  h: number;
}

/** The methods NetScene uses on the shared (or owned) GPU object. */
export class SoftwareGpu {
  readonly software = true as const;
  constructor(readonly domElement: HTMLCanvasElement, private pr = 1) {}
  getPixelRatio(): number { return this.pr; }
  setPixelRatio(n: number): void { this.pr = n; }
  setSize(_w: number, _h: number, _updateStyle?: boolean): void { /* host sizes the canvas */ }
  setClearColor(_hex: number, _alpha?: number): void { /* present() fills */ }
  getContext(): null { return null; }
  render(_scene: THREE.Scene, _camera: THREE.Camera): void { /* present() paints */ }
  dispose(): void { /* canvas removed by host */ }
  forceContextLoss(): void { /* no GL */ }
  setViewport(): void { /* 2d clip */ }
  setScissor(): void { /* 2d clip */ }
  setScissorTest(): void { /* 2d clip */ }
  clear(): void { /* present() fills */ }
}

export type HostGpu = THREE.WebGLRenderer | SoftwareGpu;

function copyViewBox(dst: SoftRect, out: CssRectLoose): CssRect {
  out.x = dst.x;
  out.y = dst.y;
  out.w = dst.w;
  out.h = dst.h;
  return asCssRect(out);
}

export class RenderHost {
  readonly renderer: HostGpu;
  readonly canvas: HTMLCanvasElement;
  readonly software: boolean;
  private readonly ctx2d: CanvasRenderingContext2D | null = null;
  private views: HostedView[] = [];
  private raf = 0;
  private w = 0;
  private h = 0;
  private dirty = true;
  private canvasRect: DOMRect | null = null;
  private readonly ro: ResizeObserver | null;
  private readonly frame: (ts: number) => void;
  private disposed = false;
  private pr: number;
  readonly packMirrors = new PackMirrorRegistry();
  private readonly letterboxScratch = {
    box: { x: 0, y: 0, w: 0, h: 0 },
    inner: { x: 0, y: 0, w: 0, h: 0 },
    innerAbs: { x: 0, y: 0, w: 0, h: 0 },
    bars: [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ] as LetterboxBarScratch,
  };
  private readonly fbViewport: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
  private readonly packScopeScratch = new Map<string, { tileCount: number; antialias: boolean }>();
  private readonly sandboxScopeScratch = new Map<string, number>();
  private mirrorScopeDirty = true;
  private contextAntialias = false;
  private readonly viewBoxScratch: SoftRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly viewBoxScratchB: SoftRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly packDrawViewport: CssRectLoose = { x: 0, y: 0, w: 0, h: 0 };
  private readonly packDrawOpts = {
    letterbox: false,
    fill: null as SurfaceLetterboxFill | null,
    aspect: 1,
  };
  private gpuTimedView: HostedView | null = null;
  private gpuTimedPackKey: string | null = null;
  private gpuTimedScene: THREE.Scene | null = null;
  private gpuTimedCamera: THREE.Camera | null = null;
  private gpuTimedClearHex = 0;
  private gpuTimedBox: SoftRect | null = null;
  private readonly bufferPixels: DevicePixelSize = { w: 0, h: 0 };

  constructor(readonly wall: HTMLElement, opts: { dpr?: number; software?: boolean; antialias?: boolean } = {}) {
    const dpr = opts.dpr ?? Math.min(devicePixelRatio || 1, 1.5);
    this.pr = dpr;
    const forceSoft = opts.software === true || (opts.software !== false && !probeWebGL());
    if (!forceSoft) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: opts.antialias ?? dpr < 1.3,
          alpha: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
          failIfMajorPerformanceCaveat: false,
        });
        this.software = false;
        this.renderer.setPixelRatio(dpr);
        this.renderer.setClearColor(0x000000, 0);
        this.canvas = this.renderer.domElement;
        this.refreshContextAntialias();
      } catch {
        this.software = true;
        this.canvas = document.createElement("canvas");
        this.renderer = new SoftwareGpu(this.canvas, dpr);
        this.ctx2d = this.canvas.getContext("2d");
      }
    } else {
      this.software = true;
      this.canvas = document.createElement("canvas");
      this.renderer = new SoftwareGpu(this.canvas, dpr);
      this.ctx2d = this.canvas.getContext("2d");
    }
    this.canvas.className = "render-host";
    this.canvas.setAttribute("aria-hidden", "true");
    if (this.software) this.canvas.dataset.softgl = "";
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      for (const v of this.views) v.hostContextLost();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.dirty = true;
      this.refreshContextAntialias();
      this.markMirrorScopeDirty();
      for (const v of this.views) v.hostContextRestored();
    });
    this.attach();
    this.syncSize();
    this.ro = observeResize(wall, () => { this.dirty = true; });
    this.frame = (ts: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(this.frame);
      this.attach();
      this.syncSize();
      if (this.dirty) {
        this.dirty = false;
        if (!this.software) {
          this.renderer.setScissorTest(false);
          this.renderer.setClearColor(0x000000, 0);
          this.renderer.clear();
        } else if (this.ctx2d) {
          this.ctx2d.setTransform(1, 0, 0, 1, 0, 0);
          this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
      }
      this.canvasRect = this.canvas.getBoundingClientRect();
      harvestGpu();
      this.packMirrors.beginFrame();
      this.syncMirrorScopesIfNeeded();
      const frameTs = frameTsFromRaf(ts);
      for (const v of this.views) v.hostFrame(frameTs);
      finishSandboxBitmapHostFrame();
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  get pixelRatio(): number { return this.software ? this.pr : this.renderer.getPixelRatio(); }
  get viewCount(): number { return this.views.length; }

  /** Same object every call; dimensions refreshed from the canvas backing store. */
  bufferPixelSize(): Readonly<DevicePixelSize> {
    this.bufferPixels.w = this.canvas.width;
    this.bufferPixels.h = this.canvas.height;
    return this.bufferPixels;
  }

  /** WebGL2 context, or null when lost / unavailable. */
  get gl(): WebGL2RenderingContext | null {
    const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
    return gl && typeof gl.fenceSync === "function" ? gl : null;
  }

  add(v: HostedView): void {
    if (!this.views.includes(v)) this.views.push(v);
    this.dirty = true;
    this.markMirrorScopeDirty();
  }

  remove(v: HostedView): void {
    const i = this.views.indexOf(v);
    if (i >= 0) this.views.splice(i, 1);
    this.dirty = true;
    this.markMirrorScopeDirty();
  }

  /** Pane geometry changed (mosaic layout, hero swap): clear stale pixels outside the new viewports. */
  invalidate(): void {
    this.dirty = true;
    this.markMirrorScopeDirty();
  }

  /** Pack-mirror tile metadata changed without add/remove (mosaic coalesce). */
  markMirrorScopeDirty(): void {
    this.mirrorScopeDirty = true;
  }

  /** Run one animation frame (tests / dogfood). */
  advanceFrame(ts: number): void {
    if (!this.disposed) this.frame(ts);
  }

  /**
   * Letterbox a primary pack tile into a duplicate tile viewport (same host frame, no second pack tick).
   */
  presentPackMirror(
    primary: HostedView,
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
  ): Viewport | null {
    if (!this.viewBoxInto(mirror, this.viewBoxScratch)) return null;
    const dst = this.viewBoxScratch;
    if (!this.viewBoxInto(primary, this.viewBoxScratchB)) return null;
    const src = this.viewBoxScratchB;
    if (dst.w < 2 || dst.h < 2) return null;
    const aspect = src.w / Math.max(1, src.h);
    const box = copyViewBox(dst, this.letterboxScratch.box);
    const inner = letterboxInnerRect(dst, aspect);
    this.letterboxScratch.inner.x = inner.x + dst.x;
    this.letterboxScratch.inner.y = inner.y + dst.y;
    this.letterboxScratch.inner.w = inner.w;
    this.letterboxScratch.inner.h = inner.h;
    const innerPaint = this.letterboxScratch.inner;
    if (this.software) {
      const ctx = this.ctx2d;
      if (!ctx) return null;
      const pr = this.pr;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      paintLetterboxBars(ctx, box, innerPaint, fill);
      ctx.save();
      ctx.beginPath();
      ctx.rect(innerPaint.x, innerPaint.y, innerPaint.w, innerPaint.h);
      ctx.clip();
      ctx.drawImage(
        this.canvas,
        src.x * pr,
        src.y * pr,
        src.w * pr,
        src.h * pr,
        innerPaint.x,
        innerPaint.y,
        innerPaint.w,
        innerPaint.h,
      );
      ctx.restore();
      return this.writeFbViewport(dst, pr);
    }
    const rd = this.renderer as THREE.WebGLRenderer;
    const key = packMirrorMeta(mirror).packCoalesceGroupKey;
    if (!key) return null;
    const rect = this.packMirrors.presentPack(key, rd, asCssRect(dst), { letterbox: true, fill, aspect });
    if (!rect) return null;
    return this.writeFbViewport(dst, rd.getPixelRatio());
  }

  /**
   * Letterbox a sandbox `ImageBitmap` into a duplicate tile (no canvas readback).
   */
  presentBitmapMirror(
    mirror: HostedView,
    bitmap: ImageBitmap,
    fill: SurfaceLetterboxFill,
    aspect: number,
    pluginId: string,
    releaseBitmap = true,
  ): Viewport | null {
    try {
      if (!this.viewBoxInto(mirror, this.viewBoxScratch)) return null;
      const dst = this.viewBoxScratch;
      if (dst.w < 2 || dst.h < 2) return null;
      const box = copyViewBox(dst, this.letterboxScratch.box);
      const inner = letterboxInnerRect(dst, aspect);
      this.letterboxScratch.inner.x = inner.x + dst.x;
      this.letterboxScratch.inner.y = inner.y + dst.y;
      this.letterboxScratch.inner.w = inner.w;
      this.letterboxScratch.inner.h = inner.h;
      const innerPaint = this.letterboxScratch.inner;
      if (this.software) {
        const ctx = this.ctx2d;
        if (!ctx) return null;
        const pr = this.pr;
        ctx.setTransform(pr, 0, 0, pr, 0, 0);
        paintLetterboxBars(ctx, box, innerPaint, fill);
        if (bitmap.width >= 2 && bitmap.height >= 2) {
          ctx.drawImage(bitmap, innerPaint.x, innerPaint.y, innerPaint.w, innerPaint.h);
        }
        return this.writeFbViewport(dst, pr);
      }
      const rd = this.renderer as THREE.WebGLRenderer;
      const gpu = sandboxBitmapGl(pluginId);
      const pr = rd.getPixelRatio();
      const tex = gpu.uploadFrame(bitmap);
      if (!tex) return null;
      gpu.present(rd, tex, fill, asCssRect(dst), aspect);
      return this.writeFbViewport(dst, pr);
    } finally {
      if (releaseBitmap) bitmap.close();
    }
  }

  /** Surface letterbox only (no bitmap yet, no publish failure). */
  presentSandboxMirrorLetterbox(
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
    aspect: number,
  ): Viewport | null {
    if (!this.viewBoxInto(mirror, this.viewBoxScratch)) return null;
    const dst = this.viewBoxScratch;
    if (dst.w < 2 || dst.h < 2) return null;
    const box = copyViewBox(dst, this.letterboxScratch.box);
    const inner = letterboxInnerRect(dst, aspect);
    const innerAbs = this.letterboxScratch.innerAbs;
    innerAbs.x = dst.x + inner.x;
    innerAbs.y = dst.y + inner.y;
    innerAbs.w = inner.w;
    innerAbs.h = inner.h;
    if (this.software) {
      const ctx = this.ctx2d;
      if (!ctx) return null;
      const pr = this.pr;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      this.letterboxScratch.inner.x = innerAbs.x;
      this.letterboxScratch.inner.y = innerAbs.y;
      this.letterboxScratch.inner.w = innerAbs.w;
      this.letterboxScratch.inner.h = innerAbs.h;
      paintLetterboxBars(ctx, box, this.letterboxScratch.inner, fill);
      return this.writeFbViewport(dst, pr);
    }
    const rd = this.renderer as THREE.WebGLRenderer;
    paintLetterboxBarsThree(rd, fill, asCssRect(dst), asCssRect(innerAbs), this.letterboxScratch.bars);
    return this.writeFbViewport(dst, rd.getPixelRatio());
  }

  presentSandboxMirrorPlaceholder(
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
    packName: string,
    mirrorsTile: number,
  ): Viewport | null {
    if (!this.viewBoxInto(mirror, this.viewBoxScratch)) return null;
    const dst = this.viewBoxScratch;
    if (dst.w < 2 || dst.h < 2) return null;
    const el = mirror.viewEl;
    let badge = el.querySelector<HTMLElement>(".pack-mirror-placeholder");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "pack-mirror-placeholder";
      el.appendChild(badge);
    }
    badge.textContent = `${packName} · mirrors tile ${mirrorsTile}`;
    badge.hidden = false;
    if (this.software) {
      const ctx = this.ctx2d;
      if (!ctx) return null;
      const pr = this.pr;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      paintPackMirrorPlaceholder(ctx, dst, fill, packName, mirrorsTile);
    } else {
      const rd = this.renderer as THREE.WebGLRenderer;
      rd.setScissorTest(true);
      rd.setViewport(dst.x, dst.y, dst.w, dst.h);
      rd.setScissor(dst.x, dst.y, dst.w, dst.h);
      rd.setClearColor(letterboxFillHex(fill), 1);
      rd.clear(true, false, false);
    }
    const pr = this.software ? this.pr : (this.renderer as THREE.WebGLRenderer).getPixelRatio();
    return this.writeFbViewport(dst, pr);
  }

  /** Whole-wall pixel ratio (auto-tune). No-op when unchanged. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.pr = pr;
    this.renderer.setPixelRatio(pr);
    if (!this.software) this.renderer.setSize(this.w, this.h, false);
    else this.resizeSoftware();
    this.dirty = true;
  }

  /**
   * Draw `scene` through `camera` into the viewport under `view.viewEl`, clearing it to `clearHex`.
   * Returns the viewport in framebuffer pixels, or null when the element is off the wall.
   */
  present(view: HostedView, clearHex: number, scene: THREE.Scene, camera: THREE.Camera): Viewport | null {
    if (!this.viewBoxInto(view, this.viewBoxScratch)) return null;
    const box = this.viewBoxScratch;
    const { x, y, w, h } = box;
    if (this.software) {
      const ctx = this.ctx2d;
      if (ctx) {
        const pr = this.pr;
        ctx.setTransform(pr, 0, 0, pr, 0, 0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = cssHex(clearHex);
        ctx.fillRect(x, y, w, h);
        view.paintSoftware?.(ctx, { x, y, w, h });
        ctx.restore();
      }
      return this.writeFbViewport(box, this.pr);
    }
    const rd = this.renderer as THREE.WebGLRenderer;
    const gl = this.gl;
    const pr = rd.getPixelRatio();
    const meta = packMirrorMeta(view);
    const tileCount = meta.packCoalesceTileCount ?? 0;
    const packKey = meta.packCoalesceGroupKey;
    const packPrimary = meta.isPackMirrorPrimary === true;
    if (packPrimary && tileCount >= 2 && packKey && gl) {
      this.gpuTimedView = view;
      this.gpuTimedPackKey = packKey;
      this.gpuTimedScene = scene;
      this.gpuTimedCamera = camera;
      this.gpuTimedClearHex = clearHex;
      this.gpuTimedBox = box;
      timeGpu(gl, this.runTimedPackPrimaryDraw, this.runTimedGpuNote);
      this.gpuTimedView = null;
      this.gpuTimedPackKey = null;
      this.gpuTimedScene = null;
      this.gpuTimedCamera = null;
      this.gpuTimedBox = null;
      return this.writeFbViewport(box, pr);
    }
    this.gpuTimedView = view;
    this.gpuTimedScene = scene;
    this.gpuTimedCamera = camera;
    this.gpuTimedClearHex = clearHex;
    this.gpuTimedBox = box;
    if (gl) {
      timeGpu(gl, this.runTimedViewDraw, this.runTimedGpuNote);
    } else {
      this.runTimedViewDraw();
    }
    this.gpuTimedView = null;
    this.gpuTimedScene = null;
    this.gpuTimedCamera = null;
    this.gpuTimedBox = null;
    return this.writeFbViewport(box, pr);
  }

  private readonly runTimedGpuNote = (ms: number): void => {
    this.gpuTimedView?.noteFrameCost?.(ms);
  };

  private readonly runTimedPackPrimaryDraw = (): void => {
    const packKey = this.gpuTimedPackKey;
    const box = this.gpuTimedBox;
    const scene = this.gpuTimedScene;
    const camera = this.gpuTimedCamera;
    if (!packKey || !box || !scene || !camera) return;
    const rd = this.renderer as THREE.WebGLRenderer;
    this.packMirrors.renderPrimary(
      packKey,
      rd,
      scene,
      camera,
      asCssRect(box),
      this.gpuTimedClearHex,
      this.contextAntialias,
    );
    this.packDrawViewport.x = box.x;
    this.packDrawViewport.y = box.y;
    this.packDrawViewport.w = box.w;
    this.packDrawViewport.h = box.h;
    this.packDrawOpts.letterbox = false;
    this.packDrawOpts.fill = null;
    this.packDrawOpts.aspect = box.w / Math.max(1, box.h);
    this.packMirrors.presentPack(packKey, rd, asCssRect(this.packDrawViewport), this.packDrawOpts);
  };

  private readonly runTimedViewDraw = (): void => {
    const box = this.gpuTimedBox;
    const scene = this.gpuTimedScene;
    const camera = this.gpuTimedCamera;
    if (!box || !scene || !camera) return;
    const rd = this.renderer as THREE.WebGLRenderer;
    rd.setViewport(box.x, box.y, box.w, box.h);
    rd.setScissor(box.x, box.y, box.w, box.h);
    rd.setScissorTest(true);
    rd.setClearColor(this.gpuTimedClearHex, 1);
    rd.render(scene, camera);
  };

  private canvasDeviceHeight(): number {
    return Math.max(1, this.canvas.height);
  }

  private writeFbViewport(box: SoftRect, pr: number): Viewport {
    const cssTop = this.software
      ? asCssRect(box)
      : cssRectTopFromBottomLeft(box, this.h);
    return toDeviceRectInto(
      cssTop,
      pr,
      this.canvasDeviceHeight(),
      this.fbViewport,
    );
  }

  private sortViewsForMirror(): void {
    renderHostMirrorTelemetry.viewSortRuns += 1;
    this.views.sort((a, b) => {
      const ma = packMirrorMeta(a).isPackMirrorPrimary ? 0 : 1;
      const mb = packMirrorMeta(b).isPackMirrorPrimary ? 0 : 1;
      return ma - mb;
    });
  }

  private syncMirrorScopesIfNeeded(): void {
    renderHostMirrorTelemetry.scopeDirtyChecks += 1;
    if (!this.mirrorScopeDirty) return;
    this.mirrorScopeDirty = false;
    renderHostMirrorTelemetry.scopeSyncRuns += 1;
    const antialias = this.contextAntialias;
    this.packScopeScratch.clear();
    for (const v of this.views) {
      const meta = packMirrorMeta(v);
      const key = meta.packCoalesceGroupKey;
      const tileCount = meta.packCoalesceTileCount ?? 0;
      if (!key || tileCount < 2) continue;
      this.packScopeScratch.set(key, { tileCount, antialias });
    }
    this.packMirrors.syncScopes(this.packScopeScratch);
    this.sandboxScopeScratch.clear();
    for (const v of this.views) {
      const meta = packMirrorMeta(v);
      const pluginId = meta.packSandboxMirrorPluginId;
      const tileCount = meta.packCoalesceTileCount ?? 0;
      if (pluginId && tileCount >= 2) this.sandboxScopeScratch.set(pluginId, tileCount);
    }
    syncSandboxBitmapGpuScopes(this.sandboxScopeScratch);
    this.sortViewsForMirror();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.views = [];
    if (!this.software) {
      this.packMirrors.dispose();
      resetSandboxBitmapGl();
    }
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** Mosaic teardown empties #wall; put the canvas back underneath whatever it rebuilt. */
  private attach(): void {
    if (this.wall.firstElementChild !== this.canvas) this.wall.prepend(this.canvas);
  }

  viewBox(view: HostedView): SoftRect | null {
    if (!this.viewBoxInto(view, this.viewBoxScratch)) return null;
    return this.viewBoxScratch;
  }

  private viewBoxInto(view: HostedView, out: SoftRect): boolean {
    const c = this.canvasRect ?? this.canvas.getBoundingClientRect();
    const r = view.viewEl.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || c.width < 2 || c.height < 2) return false;
    const x = r.left - c.left;
    const y = this.software ? r.top - c.top : c.bottom - r.bottom;
    const w = r.width;
    const h = r.height;
    if (x + w <= 0 || y + h <= 0 || x >= c.width || y >= c.height) return false;
    out.x = x;
    out.y = y;
    out.w = w;
    out.h = h;
    return true;
  }

  private refreshContextAntialias(): void {
    renderHostMirrorTelemetry.getContextAttributesCalls += 1;
    const gl = this.gl;
    this.contextAntialias = gl?.getContextAttributes()?.antialias === true;
  }

  private syncSize(): void {
    const w = this.wall.clientWidth, h = this.wall.clientHeight;
    if (w < 2 || h < 2 || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    if (!this.software) this.renderer.setSize(w, h, false);
    else this.resizeSoftware();
    this.dirty = true;
  }

  private resizeSoftware(): void {
    const pr = this.pr;
    this.canvas.width = Math.max(1, Math.round(this.w * pr));
    this.canvas.height = Math.max(1, Math.round(this.h * pr));
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.bufferPixels.w = this.canvas.width;
    this.bufferPixels.h = this.canvas.height;
  }
}
