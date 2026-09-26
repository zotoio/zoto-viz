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
import { PackMirrorGl } from "./pack-mirror-gl";

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

/** A viewport in framebuffer pixels, origin bottom-left (what `gl.readPixels` wants). */
export interface Viewport { x: number; y: number; w: number; h: number }

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
  private readonly packMirrorGl = new PackMirrorGl();

  constructor(readonly wall: HTMLElement, opts: { dpr?: number; software?: boolean } = {}) {
    const dpr = opts.dpr ?? Math.min(devicePixelRatio || 1, 1.5);
    this.pr = dpr;
    const forceSoft = opts.software === true || (opts.software !== false && !probeWebGL());
    if (!forceSoft) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: dpr < 1.3,
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
      const mirrorRank = (v: HostedView) => ((v as { packMirrorPrimary?: unknown }).packMirrorPrimary ? 1 : 0);
      this.views.sort((a, b) => mirrorRank(a) - mirrorRank(b));
      for (const v of this.views) v.hostFrame(ts);
      finishSandboxBitmapHostFrame();
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  get pixelRatio(): number { return this.software ? this.pr : this.renderer.getPixelRatio(); }
  get viewCount(): number { return this.views.length; }

  /** WebGL2 context, or null when lost / unavailable. */
  get gl(): WebGL2RenderingContext | null {
    const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
    return gl && typeof gl.fenceSync === "function" ? gl : null;
  }

  add(v: HostedView): void {
    if (!this.views.includes(v)) this.views.push(v);
    this.dirty = true;
  }

  remove(v: HostedView): void {
    const i = this.views.indexOf(v);
    if (i >= 0) this.views.splice(i, 1);
    this.dirty = true;
  }

  /** Pane geometry changed (mosaic layout, hero swap): clear stale pixels outside the new viewports. */
  invalidate(): void { this.dirty = true; }

  /**
   * Letterbox a primary pack tile into a duplicate tile viewport (same host frame, no second pack tick).
   */
  presentPackMirror(
    primary: HostedView,
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
  ): Viewport | null {
    const dst = this.viewBox(mirror);
    const src = this.viewBox(primary);
    if (!dst || !src || dst.w < 2 || dst.h < 2) return null;
    const aspect = src.w / Math.max(1, src.h);
    const inner = letterboxInnerRect(dst, aspect);
    inner.x += dst.x;
    inner.y += dst.y;
    const box = { ...dst };
    if (this.software) {
      const ctx = this.ctx2d;
      if (!ctx) return null;
      const pr = this.pr;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      paintLetterboxBars(ctx, box, inner, fill);
      ctx.save();
      ctx.beginPath();
      ctx.rect(inner.x, inner.y, inner.w, inner.h);
      ctx.clip();
      ctx.drawImage(
        this.canvas,
        src.x * pr,
        src.y * pr,
        src.w * pr,
        src.h * pr,
        inner.x,
        inner.y,
        inner.w,
        inner.h,
      );
      ctx.restore();
      return { x: dst.x * pr, y: dst.y * pr, w: dst.w * pr, h: dst.h * pr };
    }
    const rd = this.renderer as THREE.WebGLRenderer;
    const gl = this.gl;
    if (!gl) return null;
    const pr = rd.getPixelRatio();
    const sx = Math.round(src.x * pr);
    const sy = Math.round(src.y * pr);
    const sw = Math.round(src.w * pr);
    const sh = Math.round(src.h * pr);
    this.packMirrorGl.captureFromScreen(gl, sx, sy, sw, sh);
    return this.packMirrorGl.blitToViewport(gl, rd, fill, dst, pr, aspect);
  }

  /**
   * Letterbox a sandbox `ImageBitmap` into a duplicate tile (no canvas readback).
   */
  presentBitmapMirror(
    mirror: HostedView,
    bitmap: ImageBitmap,
    fill: SurfaceLetterboxFill,
    aspect: number,
  ): Viewport | null {
    const dst = this.viewBox(mirror);
    if (!dst || dst.w < 2 || dst.h < 2) return null;
    const inner = letterboxInnerRect(dst, aspect);
    inner.x += dst.x;
    inner.y += dst.y;
    const box = { ...dst };
    if (this.software) {
      const ctx = this.ctx2d;
      if (!ctx) return null;
      const pr = this.pr;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      paintLetterboxBars(ctx, box, inner, fill);
      ctx.drawImage(bitmap, inner.x, inner.y, inner.w, inner.h);
      return { x: dst.x * pr, y: dst.y * pr, w: dst.w * pr, h: dst.h * pr };
    }
    const gl = this.gl;
    const rd = this.renderer as THREE.WebGLRenderer;
    if (!gl) return null;
    const pr = rd.getPixelRatio();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const ix = Math.round(inner.x * pr);
    const iy = Math.round(inner.y * pr);
    const iw = Math.round(inner.w * pr);
    const ih = Math.round(inner.h * pr);
    const dX = Math.round(dst.x * pr);
    const dY = Math.round(dst.y * pr);
    const dW = Math.round(dst.w * pr);
    const dH = Math.round(dst.h * pr);
    rd.setScissorTest(true);
    rd.setViewport(dX, dY, dW, dH);
    rd.setScissor(dX, dY, dW, dH);
    rd.setClearColor(letterboxFillHex(fill), 1);
    rd.clear(true, false, false);
    gl.blitFramebuffer(0, 0, bitmap.width, bitmap.height, ix, iy, ix + iw, iy + ih, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return { x: ix, y: iy, w: iw, h: ih };
  }

  /** Surface letterbox only (no bitmap yet, no publish failure). */
  presentSandboxMirrorLetterbox(
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
    aspect: number,
  ): Viewport | null {
    const dst = this.viewBox(mirror);
    if (!dst || dst.w < 2 || dst.h < 2) return null;
    const inner = letterboxInnerRect(dst, aspect);
    inner.x += dst.x;
    inner.y += dst.y;
    const box = { ...dst };
    if (this.software) {
      const ctx = this.ctx2d;
      if (!ctx) return null;
      const pr = this.pr;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      paintLetterboxBars(ctx, box, inner, fill);
      return { x: dst.x * pr, y: dst.y * pr, w: dst.w * pr, h: dst.h * pr };
    }
    const rd = this.renderer as THREE.WebGLRenderer;
    const gl = this.gl;
    if (!gl) return null;
    const pr = rd.getPixelRatio();
    const dX = Math.round(dst.x * pr);
    const dY = Math.round(dst.y * pr);
    const dW = Math.round(dst.w * pr);
    const dH = Math.round(dst.h * pr);
    rd.setScissorTest(true);
    rd.setViewport(dX, dY, dW, dH);
    rd.setScissor(dX, dY, dW, dH);
    rd.setClearColor(letterboxFillHex(fill), 1);
    rd.clear(true, false, false);
    return { x: dX, y: dY, w: dW, h: dH };
  }

  presentSandboxMirrorPlaceholder(
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
    packName: string,
    mirrorsTile: number,
  ): Viewport | null {
    const dst = this.viewBox(mirror);
    if (!dst || dst.w < 2 || dst.h < 2) return null;
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
      const gl = this.gl;
      const rd = this.renderer as THREE.WebGLRenderer;
      if (gl) {
        const pr = rd.getPixelRatio();
        const dX = Math.round(dst.x * pr);
        const dY = Math.round(dst.y * pr);
        const dW = Math.round(dst.w * pr);
        const dH = Math.round(dst.h * pr);
        rd.setScissorTest(true);
        rd.setViewport(dX, dY, dW, dH);
        rd.setScissor(dX, dY, dW, dH);
        rd.setClearColor(letterboxFillHex(fill), 1);
        rd.clear(true, false, false);
      }
    }
    const pr = this.software ? this.pr : (this.renderer as THREE.WebGLRenderer).getPixelRatio();
    return { x: dst.x * pr, y: dst.y * pr, w: dst.w * pr, h: dst.h * pr };
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
    const box = this.viewBox(view);
    if (!box) return null;
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
      return { x: x * this.pr, y: y * this.pr, w: w * this.pr, h: h * this.pr };
    }
    const rd = this.renderer as THREE.WebGLRenderer;
    const gl = this.gl;
    const draw = () => {
      rd.setViewport(x, y, w, h);
      rd.setScissor(x, y, w, h);
      rd.setScissorTest(true);
      rd.setClearColor(clearHex, 1);
      rd.render(scene, camera);
    };
    if (gl) timeGpu(gl, draw, (ms) => view.noteFrameCost?.(ms));
    else draw();
    const pr = rd.getPixelRatio();
    return { x: x * pr, y: y * pr, w: w * pr, h: h * pr };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.views = [];
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** Mosaic teardown empties #wall; put the canvas back underneath whatever it rebuilt. */
  private attach(): void {
    if (this.wall.firstElementChild !== this.canvas) this.wall.prepend(this.canvas);
  }

  viewBox(view: HostedView): SoftRect | null {
    const c = this.canvasRect ?? this.canvas.getBoundingClientRect();
    const r = view.viewEl.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || c.width < 2 || c.height < 2) return null;
    const x = r.left - c.left;
    const y = this.software ? r.top - c.top : c.bottom - r.bottom;
    const w = r.width;
    const h = r.height;
    if (x + w <= 0 || y + h <= 0 || x >= c.width || y >= c.height) return null;
    return { x, y, w, h };
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
  }
}
