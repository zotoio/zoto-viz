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
import { probeWebGL } from "./webgl";
import { observeResize } from "../core/resize";
import { harvestGpu, timeGpu } from "../core/gpu-time";
import { TileShaderLatch } from "./tile-shader-latch";
import { GfxWallNotice } from "./gfx-wall-notice";
import { mintContextGen, type ContextGen } from "./context-gen.mint";
import {
  LetterboxFillCache,
  NixieUploadCache,
  UniformUploadCache,
} from "./host-gl-caches";
import { TileShaderFallback } from "./tile-shader-fallback";
import type { VizDataFrame } from "../plugins/viz-host";

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

const GL_CONTEXT_LISTENERS_KEY = "__zotoGlContextListeners";

function attachGlContextListeners(
  canvas: HTMLCanvasElement,
  onLost: (e: Event) => void,
  onRestored: () => void,
): void {
  const marked = canvas as HTMLCanvasElement & { [GL_CONTEXT_LISTENERS_KEY]?: boolean };
  if (marked[GL_CONTEXT_LISTENERS_KEY]) return;
  marked[GL_CONTEXT_LISTENERS_KEY] = true;
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
}

class TileShaderSlot {
  readonly latch = new TileShaderLatch();
  fallback: TileShaderFallback | null = null;
  packKey = "";
  packId = "";
  packName = "";
  mount: HTMLElement | null = null;
  supportsPackFallback = false;
  compileFailed = false;
  mountedFallbackPackKey = "";
  stagedPush: string | null = null;

  /** New pack on this pane — clears fallback and compile latch. */
  swapPack(
    packKey: string,
    packId: string,
    packName: string,
    mount: HTMLElement,
    supportsPackFallback: boolean,
  ): void {
    if (this.packKey !== packKey) {
      this.packKey = packKey;
      this.packId = packId;
      this.latch.reset();
      this.compileFailed = false;
      this.fallback?.dispose();
      this.fallback = null;
      this.mountedFallbackPackKey = "";
      this.stagedPush = null;
    }
    this.packName = packName;
    this.mount = mount;
    this.supportsPackFallback = supportsPackFallback;
  }
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
  private readonly tileShaders = new Map<string, TileShaderSlot>();
  private readonly gfxNotice: GfxWallNotice;
  private glContextLost = false;
  private contextGen: ContextGen = mintContextGen(0);
  private readonly nixieUpload = new NixieUploadCache();
  private readonly letterboxFill = new LetterboxFillCache();
  private readonly uniformUpload = new UniformUploadCache();
  private readonly liveFallbacks: TileShaderFallback[] = [];

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
    this.gfxNotice = new GfxWallNotice(wall, { onDismissLateReload: () => this.invalidate() });
    attachGlContextListeners(
      this.canvas,
      (e) => {
        e.preventDefault();
        this.onSharedContextLost();
        for (const v of this.views) v.hostContextLost();
      },
      () => {
        this.onSharedContextRestored();
        this.dirty = true;
        for (const v of this.views) v.hostContextRestored();
      },
    );
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
      for (const v of this.views) v.hostFrame(ts);
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  get pixelRatio(): number { return this.software ? this.pr : this.renderer.getPixelRatio(); }
  get viewCount(): number { return this.views.length; }
  get contextGeneration(): ContextGen { return this.contextGen; }

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

  tileSlot(tileId: string): TileShaderSlot {
    let slot = this.tileShaders.get(tileId);
    if (!slot) {
      slot = new TileShaderSlot();
      this.tileShaders.set(tileId, slot);
    }
    return slot;
  }

  beginTilePack(
    tileId: string,
    packKey: string,
    packId: string,
    mount: HTMLElement,
    packName: string,
    supportsPackFallback = false,
  ): void {
    this.tileSlot(tileId).swapPack(packKey, packId, packName, mount, supportsPackFallback);
  }

  /**
   * Compile a plugin sky for one tile and mount or clear the shader fallback overlay.
   */
  /**
   * Compile the plugin sky material already on the scene (one Three.js compile).
   * Returns false when latched after a shader error.
   */
  compilePluginSky(
    tileId: string,
    scene: THREE.Scene,
    camera: THREE.Camera,
    log: (msg: string) => void = () => {},
  ): boolean {
    if (this.software) return true;
    if (this.glContextLost) return false;
    const rd = this.renderer as THREE.WebGLRenderer;
    if (typeof rd.compile !== "function") return true;
    const slot = this.tileSlot(tileId);
    const latch = slot.latch;
    const gen = this.contextGen;
    if (latch.dead) return false;
    if (latch.isFresh(gen)) return true;

    if (!rd.debug) {
      rd.debug = { checkShaderErrors: true, onShaderError: null };
    }
    const prevCheck = rd.debug.checkShaderErrors;
    const prevOn = rd.debug.onShaderError;
    rd.debug.checkShaderErrors = true;
    rd.debug.onShaderError = (gl, program, _vs, fs) => {
      const msg = (
        gl.getShaderInfoLog(fs)
        || gl.getProgramInfoLog(program)
        || "shader failed"
      ).trim();
      latch.fail(msg || "shader failed", log);
    };
    try {
      rd.compile(scene, camera);
    } finally {
      rd.debug.checkShaderErrors = prevCheck;
      rd.debug.onShaderError = prevOn;
    }
    if (latch.dead) return false;
    latch.markCompiled(gen);
    return true;
  }

  onTileShaderCompileFailed(tileId: string): void {
    this.mountShaderFallback(tileId);
  }

  onTileShaderCompileOk(tileId: string): void {
    this.clearShaderFallback(tileId);
  }

  /** Write-on-change nixie clock UBO upload for the shared wall. */
  syncNixieUpload(tSec: number, look?: Record<string, string>): boolean {
    if (this.software || this.glContextLost) return false;
    if (!this.gl) return false;
    return this.nixieUpload.upload(this.contextGen, tSec, look ?? {}, () => {});
  }

  /** Letterbox viewport fill rebuild (shared across tiles with identical geometry). */
  syncLetterboxFill(w: number, h: number, clearHex: number): boolean {
    if (this.software || this.glContextLost) return false;
    if (!this.gl) return false;
    return this.letterboxFill.rebuild(this.contextGen, w, h, clearHex, () => {});
  }

  /** Change-only uniform upload on the host GL path. */
  syncUniformUpload(name: string, value: number | readonly [number, number, number]): boolean {
    if (this.software || this.glContextLost) return false;
    if (!this.gl) return false;
    return this.uniformUpload.upload(this.contextGen, name, value, () => {});
  }

  mountShaderFallback(tileId: string, contextLoss = false): void {
    const slot = this.tileSlot(tileId);
    if (!contextLoss) slot.compileFailed = true;
    if (!slot.mount) return;
    if (slot.fallback && slot.mountedFallbackPackKey === slot.packKey) return;
    this.untrackFallback(slot.fallback);
    slot.fallback?.dispose();
    const staged = slot.stagedPush?.trim() || "";
    slot.fallback = new TileShaderFallback(slot.mount, {
      packName: slot.packName,
      packPush: slot.supportsPackFallback && !contextLoss,
      contextLoss,
      skipGrace: !!staged && slot.supportsPackFallback && !contextLoss,
      initialText: staged || undefined,
    });
    slot.mountedFallbackPackKey = slot.packKey;
    this.liveFallbacks.push(slot.fallback);
  }

  receiveFallbackPush(tileId: string, text: string): void {
    const slot = this.tileSlot(tileId);
    const trimmed = text.trim();
    if (!trimmed) return;
    slot.stagedPush = trimmed;
    if (!slot.fallback) return;
    slot.fallback.pushPackText(trimmed);
  }

  clearShaderFallback(tileId: string): void {
    const slot = this.tileShaders.get(tileId);
    if (!slot) return;
    this.untrackFallback(slot.fallback);
    slot.fallback?.dispose();
    slot.fallback = null;
    slot.mountedFallbackPackKey = "";
    slot.compileFailed = false;
    slot.stagedPush = null;
  }

  fallbackGraceFrames(tileId: string): number {
    return this.tileSlot(tileId).fallback?.graceFramesLeft ?? 0;
  }

  driveShaderFallbacks(_frame: VizDataFrame): void {
    for (let i = 0; i < this.liveFallbacks.length; i++) {
      this.liveFallbacks[i]!.tickGrace();
    }
  }

  private untrackFallback(fb: TileShaderFallback | null): void {
    if (!fb) return;
    const i = this.liveFallbacks.indexOf(fb);
    if (i >= 0) this.liveFallbacks.splice(i, 1);
  }

  get gfxWallNotice(): GfxWallNotice {
    return this.gfxNotice;
  }

  /** Tests / diagnostics: dispatch a shared context loss on the host canvas. */
  dispatchContextLost(): void {
    const e = new Event("webglcontextlost", { cancelable: true });
    this.canvas.dispatchEvent(e);
  }

  dispatchContextRestored(): void {
    this.canvas.dispatchEvent(new Event("webglcontextrestored"));
  }

  private onSharedContextLost(): void {
    if (this.glContextLost) return;
    this.glContextLost = true;
    this.gfxNotice.onContextLost();
    for (const [tileId, slot] of this.tileShaders) {
      if (!slot.supportsPackFallback || slot.fallback || !slot.mount) continue;
      this.mountShaderFallback(tileId, true);
    }
  }

  private onSharedContextRestored(): void {
    this.glContextLost = false;
    this.contextGen = mintContextGen((this.contextGen as number) + 1);
    this.gfxNotice.onContextRestored();
    for (const slot of this.tileShaders.values()) {
      if (slot.fallback && slot.compileFailed) {
        slot.latch.reset();
        continue;
      }
      slot.latch.reset();
      if (slot.fallback && !slot.compileFailed) {
        this.untrackFallback(slot.fallback);
        slot.fallback.dispose();
        slot.fallback = null;
        slot.mountedFallbackPackKey = "";
      }
    }
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
    if (this.glContextLost) return { x: x * this.pr, y: y * this.pr, w: w * this.pr, h: h * this.pr };
    const rd = this.renderer as THREE.WebGLRenderer;
    const gl = this.gl;
    this.syncLetterboxFill(w, h, clearHex);
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

  private viewBox(view: HostedView): SoftRect | null {
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
