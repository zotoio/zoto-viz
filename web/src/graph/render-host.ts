/**
 * One WebGL context for every graph pane.
 *
 * Each `NetScene` used to own a canvas and a `WebGLRenderer`; a 2×4 mosaic meant eight contexts,
 * eight swap chains and eight rAF callbacks per vsync. The host owns a single canvas that covers
 * `#wall`, sits behind the panes (which are transparent where a hosted scene lives), and draws every
 * registered view into its own scissored viewport from one animation loop. Views keep their own
 * `THREE.Scene`, camera, label layer and input element — the pane's container — so pointer handling
 * and layout are untouched.
 *
 * The canvas is `alpha: true` and cleared to transparent only when the layout changes, so the
 * wall's CSS background shows through the 1px grid gaps; inside a viewport the view's own clear
 * colour is opaque.
 */

import * as THREE from "three";

export interface HostedView {
  /** element whose box on the page is this view's viewport */
  readonly viewEl: HTMLElement;
  /** update and draw one frame; call `host.present(...)` from inside */
  hostFrame(ts: number): void;
  hostContextLost(): void;
  hostContextRestored(): void;
}

/** A viewport in framebuffer pixels, origin bottom-left (what `gl.readPixels` wants). */
export interface Viewport { x: number; y: number; w: number; h: number }

export class RenderHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private views: HostedView[] = [];
  private raf = 0;
  private w = 0;
  private h = 0;
  private dirty = true;
  private canvasRect: DOMRect | null = null;
  private readonly ro: ResizeObserver | null;
  private readonly frame: (ts: number) => void;
  private disposed = false;

  constructor(readonly wall: HTMLElement, opts: { dpr?: number } = {}) {
    const dpr = opts.dpr ?? Math.min(devicePixelRatio || 1, 1.5);
    this.renderer = new THREE.WebGLRenderer({
      antialias: dpr < 1.3,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = "render-host";
    this.canvas.setAttribute("aria-hidden", "true");
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
    this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { this.dirty = true; }) : null;
    this.ro?.observe(wall);
    this.frame = (ts: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(this.frame);
      this.attach();
      this.syncSize();
      if (this.dirty) {
        this.dirty = false;
        this.renderer.setScissorTest(false);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
      }
      this.canvasRect = this.canvas.getBoundingClientRect();
      for (const v of this.views) v.hostFrame(ts);
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  get pixelRatio(): number { return this.renderer.getPixelRatio(); }
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

  /** Whole-wall pixel ratio (auto-tune). No-op when unchanged. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.renderer.getPixelRatio()) < 0.01) return;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
    this.dirty = true;
  }

  /**
   * Draw `scene` through `camera` into the viewport under `view.viewEl`, clearing it to `clearHex`.
   * Returns the viewport in framebuffer pixels, or null when the element is off the wall.
   */
  present(view: HostedView, clearHex: number, scene: THREE.Scene, camera: THREE.Camera): Viewport | null {
    const c = this.canvasRect ?? this.canvas.getBoundingClientRect();
    const r = view.viewEl.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || c.width < 2 || c.height < 2) return null;
    // CSS px, GL origin (bottom-left of the canvas)
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    const w = r.width;
    const h = r.height;
    if (x + w <= 0 || y + h <= 0 || x >= c.width || y >= c.height) return null;
    const rd = this.renderer;
    rd.setViewport(x, y, w, h);
    rd.setScissor(x, y, w, h);
    rd.setScissorTest(true);
    rd.setClearColor(clearHex, 1);
    rd.render(scene, camera);
    const pr = rd.getPixelRatio();
    return { x: x * pr, y: y * pr, w: w * pr, h: h * pr };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.views = [];
    this.renderer.dispose();
    this.canvas.remove();
  }

  /** Mosaic teardown empties #wall; put the canvas back underneath whatever it rebuilt. */
  private attach(): void {
    if (this.wall.firstElementChild !== this.canvas) this.wall.prepend(this.canvas);
  }

  private syncSize(): void {
    const w = this.wall.clientWidth, h = this.wall.clientHeight;
    if (w < 2 || h < 2 || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }
}
