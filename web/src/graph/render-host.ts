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
  type GlRectMut,
  asCssRect,
  cssRectTopFromBottomLeft,
  toDeviceRectInto,
} from "./pack-mirror-rect";
import { applyHostViewBoxToGlRenderer } from "./render-host-gl-adapter";
import { renderHostMirrorTelemetry } from "./render-host-telemetry";
import {
  configureLayoutMaxDevicePxRatio,
  devicePxRatioFromNumber,
  devicePxRatioNumber,
  layoutDevicePxRatio,
  onLayoutDevicePxRatioChange,
  pinLayoutDevicePxRatio,
  startLayoutDevicePxRatioWatch,
  type DevicePxRatio,
} from "./render-host-device-px-ratio";
import { asCanvasDeviceHeight, type CanvasDeviceHeight } from "./pack-mirror-rect";
import { RenderHostTileShader } from "./render-host-tile-shader";
import type { GfxWallNotice } from "./gfx-wall-notice";

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
  /** The tile this view draws (solo "main", or the mosaic pane id); views without one are not tiles. */
  readonly tileId?: string;
}

/**
 * The shared context's lifecycle as the host sees it (#171 (c) / #179): `lost` on the lost event,
 * `restored` on the restored event, `drawn` on the first real frame drawn after a restore (a restore
 * that never draws is not a recovery).
 */
export type ContextLifecycleEvent = "lost" | "restored" | "drawn";

/** Framebuffer pixels, origin bottom-left (what `gl.readPixels` wants). */
export type Viewport = DeviceRect;

/**
 * Canvas backing-store pixels (`canvas.width` / `canvas.height`), not CSS layout.
 * Sized from the wall viewport × DPR, capped at 1.5× for stability.
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

/**
 * Delays (ms) between the host's own attempts to bring a lost WebGL context back (#179).
 * A loss the host caused (heal ladder / pack `loseHostContext`) is restored right after its
 * `webglcontextlost` event has been handled, then retried on this schedule; a loss the browser
 * caused gets the browser's own restore first and the host's attempts after these delays.
 * When the last attempt has not brought it back, the wall offers Reload (the cant-draw state).
 * The attempts plus the final beat add up to the wall notice's own 10 s "Restoring…" window, so
 * the Reload copy never shows earlier than it did before.
 */
export const CONTEXT_RESTORE_RETRY_MS: readonly number[] = [1000, 3000, 5000];

/**
 * Where the shared context's loss recovery stands, as the wall shows it: "restoring" while the
 * "Graphics were interrupted" notice is up, "gave-up" once it offers Reload, "ok" when it is gone.
 */
export type ContextRecovery = "ok" | "restoring" | "gave-up";

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
  private readonly glViewportScratch: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };
  private readonly deviceViewportScratch: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
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
  private layoutDevicePxRatio: DevicePxRatio;
  private readonly unsubLayoutDpi: (() => void) | null;
  private _canvasDeviceHeight: CanvasDeviceHeight = asCanvasDeviceHeight(1);
  glContextLost = false;
  readonly tileShader: RenderHostTileShader;
  /** `recreateContext` asked for this loss; restore as soon as its lost event has been handled. */
  private selfLossPending = false;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreDelays: readonly number[] = CONTEXT_RESTORE_RETRY_MS;
  private restoreAttempts = 0;
  private readonly contextListeners = new Set<(ev: ContextLifecycleEvent) => void>();
  /**
   * The context came back but no real frame has drawn since: the wall notice stays up (UX Pro, #179 row 4).
   * A restore that never draws is not a recovery, so only the first drawn frame clears it.
   */
  private noticeWaitsForDraw = false;
  /** A real GL draw landed in the current host frame. */
  private drewThisFrame = false;

  constructor(
    readonly wall: HTMLElement,
    opts: {
      dpr?: number;
      software?: boolean;
      antialias?: boolean;
      maxLayoutDevicePxRatio?: number;
    } = {},
  ) {
    if (opts.maxLayoutDevicePxRatio !== undefined) {
      configureLayoutMaxDevicePxRatio(opts.maxLayoutDevicePxRatio);
    }
    if (opts.dpr !== undefined) {
      this.layoutDevicePxRatio = devicePxRatioFromNumber(opts.dpr);
      pinLayoutDevicePxRatio(this.layoutDevicePxRatio);
    } else {
      startLayoutDevicePxRatioWatch();
      this.layoutDevicePxRatio = layoutDevicePxRatio();
    }
    const dpr = devicePxRatioNumber(this.layoutDevicePxRatio);
    this.pr = dpr;
    this.unsubLayoutDpi =
      opts.dpr === undefined
        ? onLayoutDevicePxRatioChange(() => this.applyWindowLayoutDevicePxRatio())
        : null;
    this.tileShader = new RenderHostTileShader(wall, this);
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
        this.renderer.setPixelRatio(1);
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
    this.canvas.addEventListener("webglcontextlost", (e) => this.onGlContextLost(e));
    this.canvas.addEventListener("webglcontextrestored", () => this.onGlContextRestored());
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
      const frameTs = frameTsFromRaf(ts);
      this.drewThisFrame = false;
      if (!this.glContextLost) {
        for (const v of this.views) v.hostFrame(frameTs);
      }
      if (this.noticeWaitsForDraw && this.drewThisFrame && !this.glContextLost) {
        this.noticeWaitsForDraw = false;
        this.tileShader.onFirstFrameAfterRestore();
        this.emitContext("drawn");
      }
      finishSandboxBitmapHostFrame();
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  get pixelRatio(): number { return this.pr; }
  get viewCount(): number { return this.views.length; }
  get contextLost(): boolean { return this.tileShader.contextLost; }
  /**
   * Read off the wall notice itself, so it can never disagree with the screen (UX Pro, #179): the
   * notice's own 10 s window can offer Reload before (software host: without) the host's last
   * restore attempt, and a restore that has not drawn yet still shows "Graphics were interrupted".
   */
  get contextRecovery(): ContextRecovery {
    const shown = this.tileShader.gfxNotice.showing;
    if (shown === "reload") return "gave-up";
    if (shown === "interrupted") return "restoring";
    return "ok";
  }
  /** Tiles drawn by this host (views that name one), for per-tile state such as cant-draw. */
  tileIds(): string[] {
    const ids: string[] = [];
    for (const v of this.views) {
      if (v.tileId && !ids.includes(v.tileId)) ids.push(v.tileId);
    }
    return ids;
  }
  /** Subscribe to the shared context's lost / restored / first-drawn-frame events; returns an unsubscribe. */
  onContextLifecycle(fn: (ev: ContextLifecycleEvent) => void): () => void {
    this.contextListeners.add(fn);
    return () => { this.contextListeners.delete(fn); };
  }
  private emitContext(ev: ContextLifecycleEvent): void {
    for (const fn of [...this.contextListeners]) {
      try {
        fn(ev);
      } catch (e) {
        console.warn("zoto-viz context lifecycle listener:", e);
      }
    }
  }
  get canvasDeviceHeight(): CanvasDeviceHeight { return this._canvasDeviceHeight; }
  get gfxWallNotice(): GfxWallNotice { return this.tileShader.gfxNotice; }

  beginTilePack(
    tileId: string,
    packKey: string,
    packId: string,
    mount: HTMLElement,
    packName: string,
    isShaderPack = false,
  ): void {
    this.tileShader.beginTilePack(tileId, packKey, packId, mount, packName, isShaderPack);
  }

  probeTileSky(
    tileId: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    log?: (msg: string) => void,
  ): string | null {
    return this.tileShader.probeTileSky(tileId, scene, camera, log);
  }

  compilePluginSky(
    tileId: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    log?: (msg: string) => void,
  ): boolean {
    return this.tileShader.compilePluginSky(tileId, scene, camera, log);
  }

  onTileShaderCompileFailed(tileId: string): void {
    this.tileShader.onTileShaderCompileFailed(tileId);
  }

  onTileShaderCompileOk(tileId: string): void {
    this.tileShader.onTileShaderCompileOk(tileId);
  }

  clearShaderFallback(tileId: string): void {
    this.tileShader.clearShaderFallback(tileId);
  }

  tileShaderDead(tileId: string): boolean {
    return this.tileShader.tileShaderDead(tileId);
  }

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

  /**
   * Force a WebGL context loss so panes can rebuild GL state (tile heal ladder, pack
   * `loseHostContext`). The restore is requested from the `webglcontextlost` handler, never from
   * the next animation frame: Chrome refuses `restoreContext()` until the lost event has been
   * dispatched and default-prevented, and a frame can run before that task (#179 row 4).
   */
  recreateContext(): void {
    if (this.software || this.disposed) return;
    const r = this.renderer as THREE.WebGLRenderer;
    if (this.glContextLost) {
      // Already lost and handled: just try to bring it back now.
      this.scheduleContextRestore(0);
      return;
    }
    if (this.gl?.isContextLost?.() === true) return; // lost event still queued; its handler restores
    this.selfLossPending = true;
    try {
      r.forceContextLoss();
    } catch {
      this.selfLossPending = false; /* extension missing */
    }
    this.dirty = true;
  }

  private onGlContextLost(e: Event): void {
    e.preventDefault();
    if (this.disposed) return;
    const selfLoss = this.selfLossPending;
    this.selfLossPending = false;
    this.noticeWaitsForDraw = false;
    this.tileShader.onSharedContextLost();
    for (const v of this.views) v.hostContextLost();
    // Every loss gets a fresh recovery, including one right after a restore (#179 row 4).
    this.restoreAttempts = 0;
    this.restoreDelays = selfLoss ? [0, ...CONTEXT_RESTORE_RETRY_MS] : CONTEXT_RESTORE_RETRY_MS;
    this.emitContext("lost");
    // A software host (or a GL renderer without forceContextRestore) cannot ask for the context
    // back: no restore timer at all, so the wall notice's own 10 s window is the only timer the
    // loss adds (qe-hook-context-loss, #179 replay).
    if (!this.canAskForContextRestore()) return;
    this.scheduleContextRestore(this.restoreDelays[0] ?? 0);
  }

  /** True when this host can request a lost WebGL context back itself (#179). */
  private canAskForContextRestore(): boolean {
    if (this.software) return false;
    return typeof (this.renderer as Partial<THREE.WebGLRenderer>).forceContextRestore === "function";
  }

  private onGlContextRestored(): void {
    this.clearContextRestoreTimer();
    this.restoreAttempts = 0;
    if (this.disposed) return;
    this.tileShader.onSharedContextRestored();
    // The notice clears on the first real frame drawn after this, not on the event (#179 row 4).
    // A software host has no GL frames to wait for.
    if (!this.software) this.noticeWaitsForDraw = true;
    this.dirty = true;
    this.refreshContextAntialias();
    this.markMirrorScopeDirty();
    for (const v of this.views) v.hostContextRestored();
    this.emitContext("restored");
    if (this.software) {
      this.tileShader.onFirstFrameAfterRestore();
      this.emitContext("drawn");
    }
  }

  private scheduleContextRestore(delayMs: number): void {
    this.clearContextRestoreTimer();
    this.restoreTimer = setTimeout(() => this.attemptContextRestore(), delayMs);
  }

  private clearContextRestoreTimer(): void {
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  /** Ask for the context back; retry on the schedule, then offer Reload rather than stop silently. */
  private attemptContextRestore(): void {
    this.restoreTimer = null;
    if (this.disposed || this.software || !this.glContextLost) return;
    this.restoreAttempts += 1;
    try {
      (this.renderer as THREE.WebGLRenderer).forceContextRestore();
    } catch { /* extension missing */ }
    this.dirty = true;
    const next = this.restoreDelays[this.restoreAttempts];
    if (next !== undefined) {
      this.restoreTimer = setTimeout(() => {
        this.restoreTimer = null;
        if (this.glContextLost) this.attemptContextRestore();
      }, next);
      return;
    }
    // Last attempt made: give the restore it asked for one more beat, then the cant-draw state.
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      if (this.disposed || !this.glContextLost) return;
      this.tileShader.gfxNotice.offerReload();
    }, CONTEXT_RESTORE_RETRY_MS[0] ?? 1000);
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
    return this.writeFbViewport(dst, this.pr);
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
      const pr = this.pr;
      const tex = gpu.uploadFrame(bitmap);
      if (!tex) return null;
      gpu.present(rd, tex, fill, asCssRect(dst), aspect);
      this.drewThisFrame = true;
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
    return this.writeFbViewport(dst, this.pr);
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
    const pr = this.software ? this.pr : this.pr;
    return this.writeFbViewport(dst, pr);
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

  /**
   * Draw `scene` through `camera` into the viewport under `view.viewEl`, clearing it to `clearHex`.
   * Returns the viewport in framebuffer pixels, or null when the element is off the wall.
   */
  present(view: HostedView, clearHex: number, scene: THREE.Scene, camera: THREE.Camera): Viewport | null {
    if (!this.viewBoxInto(view, this.viewBoxScratch)) return null;
    const box = this.viewBoxScratch;
    const { x, y, w, h } = box;
    if (!this.software && this.glContextLost) {
      return this.writeFbViewport(box, this.pr);
    }
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
    this.drewThisFrame = true;
  };

  private readonly runTimedViewDraw = (): void => {
    const box = this.gpuTimedBox;
    const scene = this.gpuTimedScene;
    const camera = this.gpuTimedCamera;
    if (!box || !scene || !camera || this.glContextLost) return;
    const rd = this.renderer as THREE.WebGLRenderer;
    applyHostViewBoxToGlRenderer(
      rd,
      box,
      this.h,
      this.pr,
      this._canvasDeviceHeight,
      this.deviceViewportScratch,
      this.glViewportScratch,
    );
    rd.setClearColor(this.gpuTimedClearHex, 1);
    rd.render(scene, camera);
    this.drewThisFrame = true;
  };

  private writeFbViewport(box: SoftRect, pr: number): Viewport {
    const cssTop = this.software
      ? asCssRect(box)
      : cssRectTopFromBottomLeft(box, this.h);
    return toDeviceRectInto(
      cssTop,
      pr,
      this._canvasDeviceHeight as number,
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
    this.clearContextRestoreTimer();
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.unsubLayoutDpi?.();
    this.tileShader.dispose();
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
    this.contextAntialias = typeof gl?.getContextAttributes === "function"
      && gl.getContextAttributes()?.antialias === true;
  }

  refreshCanvasDeviceHeight(): void {
    this._canvasDeviceHeight = asCanvasDeviceHeight(Math.max(1, this.canvas.height));
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
    this.bufferPixels.w = this.canvas.width;
    this.bufferPixels.h = this.canvas.height;
  }

  private applyWindowLayoutDevicePxRatio(): void {
    const capped = layoutDevicePxRatio();
    const pr = devicePxRatioNumber(capped);
    if (Math.abs(pr - this.pr) < 0.01) return;
    this.layoutDevicePxRatio = capped;
    this.pr = pr;
    if (!this.software) {
      this.renderer.setPixelRatio(1);
      this.resizeGpuCanvas();
    } else {
      this.resizeSoftware();
    }
    this.dirty = true;
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

  private resizeSoftware(): void {
    const pr = this.pr;
    this.canvas.width = Math.max(1, Math.round(this.w * pr));
    this.canvas.height = Math.max(1, Math.round(this.h * pr));
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.refreshCanvasDeviceHeight();
    this.bufferPixels.w = this.canvas.width;
    this.bufferPixels.h = this.canvas.height;
  }
}
