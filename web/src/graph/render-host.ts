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
import { letterboxInnerRectInto, paintLetterboxBarsInto, type SurfaceLetterboxFill } from "./letterbox-fill";
import { probeWebGL } from "./webgl";
import { observeResize } from "../core/resize";
import { harvestGpu, timeGpu } from "../core/gpu-time";
import {
  PackMirrorRegistry,
  type LetterboxBarScratch,
} from "./pack-mirror-gl";
import {
  type CssRect,
  type CssRectLoose,
  type DeviceRect,
  type DeviceRectMut,
  type GlRect,
  type GlRectMut,
  type CanvasDeviceHeight,
  asCanvasDeviceHeight,
  asCssRect,
  deviceRectFromHostViewBoxInto,
  toGlRectInto,
  viewMutAsDeviceRect,
  viewMutAsGlRect,
} from "./pack-mirror-rect";
import { applyDeviceRectToGlRenderer } from "./render-host-gl-adapter";
import {
  type DevicePxRatio,
  devicePxRatioFromNumber,
  devicePxRatioFromWindow,
  devicePxRatioNumber,
} from "./render-host-device-px-ratio";

type PackMirrorViewMeta = HostedView & {
  packCoalesceGroupKey?: string;
  isPackMirrorPrimary?: boolean;
  packCoalesceTileCount?: number;
};

function packMirrorMeta(view: HostedView): PackMirrorViewMeta {
  return view as PackMirrorViewMeta;
}

export interface HostedView {
  /** element whose box on the page is this view's viewport */
  readonly viewEl: HTMLElement;
  /** update and draw one frame; call `host.present(...)` from inside */
  hostFrame(ts: number): void;
  hostContextLost(): void;
  hostContextRestored(): void;
  /** Canvas 2D fallback when `host.software` is set */
  paintSoftware?(ctx: CanvasRenderingContext2D, rect: SoftRect): void;
  /** GPU milliseconds for this pane's last draw, once the timer query resolves. */
  noteFrameCost?(ms: number): void;
}

/** Software panes: top-left device pixels. GPU panes: GL bottom-left (`readPixels`). */
export type Viewport = DeviceRect | GlRect;

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
  private layoutDevicePxRatio: DevicePxRatio;
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
    softBars: [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ],
  };
  private readonly fbDeviceViewport: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
  private readonly fbGlViewport: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };
  private canvasDeviceHeight: CanvasDeviceHeight = asCanvasDeviceHeight(1);
  private readonly packScopeScratch = new Map<string, { tileCount: number; antialias: boolean }>();
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
  private readonly packMirrorPresentOpts = {
    letterbox: true as const,
    fill: null as SurfaceLetterboxFill | null,
    aspect: 1,
  };
  private gpuTimedView: HostedView | null = null;
  private gpuTimedPackKey: string | null = null;
  private gpuTimedScene: THREE.Scene | null = null;
  private gpuTimedCamera: THREE.Camera | null = null;
  private gpuTimedClearHex = 0;
  private gpuTimedBox: SoftRect | null = null;

  constructor(readonly wall: HTMLElement, opts: { dpr?: number; software?: boolean; antialias?: boolean } = {}) {
    this.layoutDevicePxRatio =
      opts.dpr !== undefined ? devicePxRatioFromNumber(opts.dpr) : devicePxRatioFromWindow();
    this.pr = devicePxRatioNumber(this.layoutDevicePxRatio);
    const forceSoft = opts.software === true || (opts.software !== false && !probeWebGL());
    if (!forceSoft) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: opts.antialias ?? this.pr < 1.3,
          alpha: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
          failIfMajorPerformanceCaveat: false,
        });
        this.software = false;
        this.renderer.setPixelRatio(1);
        this.renderer.setClearColor(0x000000, 0);
        this.canvas = this.renderer.domElement;
        this.refreshContextAntialias();
      } catch {
        this.software = true;
        this.canvas = document.createElement("canvas");
        this.renderer = new SoftwareGpu(this.canvas, this.pr);
        this.ctx2d = this.canvas.getContext("2d");
      }
    } else {
      this.software = true;
      this.canvas = document.createElement("canvas");
      this.renderer = new SoftwareGpu(this.canvas, this.pr);
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
    this.refreshCanvasDeviceHeight();
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
      for (const v of this.views) v.hostFrame(ts);
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Layout DPR (capped); WebGLRenderer `getPixelRatio()` stays 1. */
  get pixelRatio(): number { return this.pr; }

  /** Capped device pixel ratio used for canvas backing store and pixel-sized materials. */
  get devicePxRatio(): DevicePxRatio {
    return this.layoutDevicePxRatio;
  }

  get layoutCssWidth(): number { return this.w; }
  get layoutCssHeight(): number { return this.h; }
  get viewCount(): number { return this.views.length; }

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
    const inner = letterboxInnerRectInto(dst, aspect, this.letterboxScratch.inner);
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
      paintLetterboxBarsInto(
        ctx,
        box,
        innerPaint,
        fill,
        this.letterboxScratch.softBars as [
          { x: number; y: number; w: number; h: number },
          { x: number; y: number; w: number; h: number },
          { x: number; y: number; w: number; h: number },
          { x: number; y: number; w: number; h: number },
        ],
      );
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
    this.packMirrorHostGl.layoutPixelRatio = this.pr;
    this.packMirrorHostGl.canvasCssHeight = this.h;
    this.packMirrorHostGl.canvasDeviceHeight = this.canvasDeviceHeight;
    this.packMirrorPresentOpts.fill = fill;
    this.packMirrorPresentOpts.aspect = aspect;
    const rect = this.packMirrors.presentPack(
      key,
      rd,
      asCssRect(dst),
      this.packMirrorPresentOpts,
      this.packMirrorHostGl,
    );
    if (!rect) return null;
    return this.writeFbViewport(dst, this.pr);
  }

  /** Whole-wall layout DPR (auto-tune). Backing store scales here; renderer pixel ratio stays 1. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.layoutDevicePxRatio = devicePxRatioFromNumber(pr);
    this.pr = devicePxRatioNumber(this.layoutDevicePxRatio);
    if (!this.software) {
      this.renderer.setPixelRatio(1);
      this.resizeGpuCanvas();
    } else {
      this.resizeSoftware();
    }
    this.dirty = true;
  }

  private readonly packMirrorHostGl = {
    layoutPixelRatio: 1,
    canvasCssHeight: 1,
    canvasDeviceHeight: asCanvasDeviceHeight(1),
  };

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
    const pr = this.pr;
    this.packMirrorHostGl.layoutPixelRatio = pr;
    this.packMirrorHostGl.canvasCssHeight = this.h;
    this.packMirrorHostGl.canvasDeviceHeight = this.canvasDeviceHeight;
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
      const vpPack = this.writeFbViewport(box, pr);
      timeGpu(gl, this.runTimedPackPrimaryDraw, this.runTimedGpuNote);
      this.gpuTimedView = null;
      this.gpuTimedPackKey = null;
      this.gpuTimedScene = null;
      this.gpuTimedCamera = null;
      this.gpuTimedBox = null;
      return vpPack;
    }
    this.gpuTimedView = view;
    this.gpuTimedScene = scene;
    this.gpuTimedCamera = camera;
    this.gpuTimedClearHex = clearHex;
    this.gpuTimedBox = box;
    const vp = this.writeFbViewport(box, pr);
    if (gl) {
      timeGpu(gl, this.runTimedViewDraw, this.runTimedGpuNote);
    } else {
      this.runTimedViewDraw();
    }
    this.gpuTimedView = null;
    this.gpuTimedScene = null;
    this.gpuTimedCamera = null;
    this.gpuTimedBox = null;
    return vp;
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
      this.packMirrorHostGl,
    );
    this.packDrawViewport.x = box.x;
    this.packDrawViewport.y = box.y;
    this.packDrawViewport.w = box.w;
    this.packDrawViewport.h = box.h;
    this.packDrawOpts.letterbox = false;
    this.packDrawOpts.fill = null;
    this.packDrawOpts.aspect = box.w / Math.max(1, box.h);
    this.packMirrors.presentPack(
      packKey,
      rd,
      asCssRect(this.packDrawViewport),
      this.packDrawOpts,
      this.packMirrorHostGl,
    );
  };

  private readonly runTimedViewDraw = (): void => {
    const scene = this.gpuTimedScene;
    const camera = this.gpuTimedCamera;
    if (!scene || !camera) return;
    const rd = this.renderer as THREE.WebGLRenderer;
    applyDeviceRectToGlRenderer(
      rd,
      viewMutAsDeviceRect(this.fbDeviceViewport),
      this.canvasDeviceHeight,
      this.fbGlViewport,
    );
    rd.setClearColor(this.gpuTimedClearHex, 1);
    rd.render(scene, camera);
  };

  private writeFbViewport(box: SoftRect, pr: number): Viewport {
    deviceRectFromHostViewBoxInto(
      box,
      this.software,
      this.h,
      pr,
      this.fbDeviceViewport,
      this.software ? undefined : this.canvasDeviceHeight,
    );
    if (this.software) {
      return viewMutAsDeviceRect(this.fbDeviceViewport);
    }
    toGlRectInto(
      viewMutAsDeviceRect(this.fbDeviceViewport),
      this.canvasDeviceHeight,
      this.fbGlViewport,
    );
    return viewMutAsGlRect(this.fbGlViewport);
  }

  private refreshCanvasDeviceHeight(): void {
    this.canvasDeviceHeight = asCanvasDeviceHeight(Math.max(1, this.canvas.height));
  }

  private sortViewsForMirror(): void {
    this.views.sort((a, b) => {
      const ma = packMirrorMeta(a).isPackMirrorPrimary ? 0 : 1;
      const mb = packMirrorMeta(b).isPackMirrorPrimary ? 0 : 1;
      return ma - mb;
    });
  }

  private syncMirrorScopesIfNeeded(): void {
    if (!this.mirrorScopeDirty) return;
    this.mirrorScopeDirty = false;
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
    this.sortViewsForMirror();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.views = [];
    if (!this.software) this.packMirrors.dispose();
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
    const gl = this.gl;
    this.contextAntialias = gl?.getContextAttributes()?.antialias === true;
  }

  private syncSize(): void {
    const w = this.wall.clientWidth, h = this.wall.clientHeight;
    if (w < 2 || h < 2 || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    if (!this.software) this.resizeGpuCanvas();
    else this.resizeSoftware();
    this.dirty = true;
  }

  private resizeGpuCanvas(): void {
    const pr = this.pr;
    const devW = Math.max(1, Math.round(this.w * pr));
    const devH = Math.max(1, Math.round(this.h * pr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(devW, devH, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.refreshCanvasDeviceHeight();
  }

  private resizeSoftware(): void {
    const pr = this.pr;
    this.canvas.width = Math.max(1, Math.round(this.w * pr));
    this.canvas.height = Math.max(1, Math.round(this.h * pr));
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.refreshCanvasDeviceHeight();
  }
}
