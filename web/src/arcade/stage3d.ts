import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { hashColor } from "../core/modes";
import { rIp, rName } from "../core/redact";
import { displayName, idsOf, type Device, type Packet, type Role, type StateMsg, type TrafficMsg } from "../core/types";
import { DEFAULT_THEME, type Theme } from "../core/themes";
import { markFrame, PaneFps } from "../core/fps";
import {
  devicePxRatioNumber,
  layoutBackingDevicePx,
  layoutDevicePxRatio,
  onLayoutDevicePxRatioChange,
} from "../graph/render-host-device-px-ratio";
import type { FrameTs } from "../core/time-ms";
import { frameTsFromRaf } from "../core/time-ms";
import { timeGpu } from "../core/gpu-time";
import { CanvasChangeProbe, PaneChangeProbe } from "../graph/pane-change";
import {
  asCanvasDeviceHeight,
  deviceRect,
  type GlRectMut,
  toGlRectInto,
} from "../graph/pack-mirror-rect";
import { probeWebGL } from "../graph/webgl";
import { observeResize } from "../core/resize";
import { POLL_MS, REPLAY_S, isKnown } from "./arcade";

/**
 * Three.js host for the 3D arcade views. One WebGL context, created on start and
 * released on stop so mosaic graph tiles are not starved. Games build meshes in
 * `root` and implement ingest / step like ArcadeView.
 */
export abstract class Stage3D {
  abstract readonly controls: HTMLElement[];
  protected msg: StateMsg | null = null;
  protected theme: Theme = DEFAULT_THEME;
  protected running = false;
  protected W = 0;
  protected H = 0;
  private layoutDpr = 0;
  protected pps = 0;
  protected lastT = 0;
  protected readonly world = new THREE.Scene();
  protected readonly root = new THREE.Group();
  protected readonly camera = new THREE.PerspectiveCamera(50, 1, 0.12, 4000);
  protected readonly camOrbit = { theta: 0.55, phi: 1.05, radius: 36, target: new THREE.Vector3(0, 2.2, 0) };
  protected renderer: THREE.WebGLRenderer | null = null;
  private fallback: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private timer: number | null = null;
  private inflight = false;
  private gen = 0;
  private lastFrame = 0;
  private dataKey = "";
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.55);
  private readonly hemi = new THREE.HemisphereLight(0xb3e5fc, 0x263238, 0.7);
  private readonly rim = new THREE.PointLight(0x90caf9, 0.55, 80, 2);
  private readonly fog = new THREE.FogExp2(0x0b1220, 0.012);

  private readonly paneFps: PaneFps;
  private readonly picture = new PaneChangeProbe();
  private readonly flatPicture = new CanvasChangeProbe();
  private readonly paneGlVpScratch: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };

  constructor(protected readonly container: HTMLElement, protected readonly scene: NetScene) {
    this.paneFps = new PaneFps(container);
    this.world.add(this.hemi);
    this.key.position.set(18, 28, 14);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 2;
    this.key.shadow.camera.far = 80;
    this.key.shadow.camera.left = -30;
    this.key.shadow.camera.right = 30;
    this.key.shadow.camera.top = 30;
    this.key.shadow.camera.bottom = -30;
    this.world.add(this.key);
    this.rim.position.set(-12, 8, -10);
    this.world.add(this.rim);
    this.world.fog = this.fog;
    this.world.add(this.root);
    this.container.addEventListener("pointerdown", this.onPtrDown);
    this.container.addEventListener("pointermove", this.onPtrMove);
    this.container.addEventListener("pointerup", this.onPtrUp);
    this.container.addEventListener("pointerleave", this.onPtrUp);
    this.container.addEventListener("wheel", this.onWheel, { passive: false });
    observeResize(this.container, () => this.fit());
    onLayoutDevicePxRatioChange(() => this.fit());
  }

  start(preferIp?: string | null): void {
    this.onStart(preferIp ?? null);
    this.ensureRenderer();
    this.running = true;
    this.lastFrame = 0;
    this.resync();
    this.onSnapshot();
    if (this.useTraffic()) {
      if (this.timer === null) this.timer = window.setInterval(() => void this.poll(), POLL_MS);
      void this.poll();
    }
    if (!this.useHostFrameLoop()) {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** When true, the shared host rAF drives {@link hostFrameTick} (no private arcade loop). */
  protected useHostFrameLoop(): boolean {
    return false;
  }

  /** One host-frame step for standalone tiles; caller supplies the sole present timestamp. */
  hostFrameTick(presentTs: FrameTs, dtSec: number): void {
    if (!this.running) return;
    const ts = Number(presentTs);
    if (!this.useHostFrameLoop()) markFrame(presentTs);
    this.paneFps.tick(ts);
    const now = ts / 1000;
    this.fit();
    if (!this.W || !this.H) return;
    this.step(now, dtSec);
    this.applyCamera();
    if (this.renderer) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
      const draw = () => this.renderer?.render(this.world, this.camera);
      if (gl) {
        timeGpu(gl, draw, (ms) => this.paneFps.noteGpu(ms));
        const vp = { x: 0, y: 0, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
        this.picture.tick(gl, vp, ts, (at) => this.paneFps.mark(at));
      } else draw();
    } else if (this.fallback && this.canvas) {
      this.drawFallback(this.fallback, now);
      if (this.flatPicture.sample(this.fallback, this.canvas)) this.paneFps.mark(ts);
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.releaseRenderer();
  }

  update(msg: StateMsg): void {
    this.msg = msg;
    if (!this.running) return;
    this.resync();
    this.onSnapshot();
  }

  setTheme(t: Theme): void {
    this.theme = t;
    const bg = new THREE.Color(t.ui.bg);
    this.world.background = bg;
    this.fog.color.copy(bg);
    this.hemi.color.set(t.ui.accent);
  }

  protected useTraffic(): boolean { return true; }
  protected abstract query(): { ip: string; peer?: string } | null;
  protected abstract ingest(fresh: Packet[], first: number, newest: number): void;
  protected abstract step(now: number, dt: number): void;
  protected onStart(_preferIp: string | null): void {}
  protected onSnapshot(): void {}
  /** Called when `/api/traffic` returns no new packets (subclasses may enable demo feeds). */
  protected onTrafficPollEmpty(): void {}
  protected variant(): string { return ""; }

  /** TEST-ONLY: lit well stage signature (lights + fog), not a flat grey fill. */
  testWellLitSkySignature(): string {
    let lights = 0;
    for (const ch of this.world.children) {
      if (ch instanceof THREE.Light) lights++;
    }
    const bg = this.world.background instanceof THREE.Color ? this.world.background.getHexString() : "none";
    const fog = this.world.fog instanceof THREE.FogExp2 ? this.world.fog.color.getHexString() : "none";
    return `lights:${lights},bg:${bg},fog:${fog}`;
  }

  protected reset(): void {
    this.gen++;
    this.lastT = 0;
    this.inflight = false;
    this.pps = 0;
  }

  protected resync(): void {
    const q = this.query();
    const key = `${q?.ip ?? ""}\u0001${q?.peer ?? ""}\u0001${this.variant()}`;
    if (key === this.dataKey) return;
    this.dataKey = key;
    this.reset();
    if (this.running) this.onSnapshot();
    if (this.running && this.useTraffic()) void this.poll();
  }

  protected applyCamera(): void {
    const { theta, phi, radius, target } = this.camOrbit;
    const p = clamp(phi, 0.12, Math.PI - 0.12);
    this.camera.position.set(
      target.x + radius * Math.sin(p) * Math.cos(theta),
      target.y + radius * Math.cos(p),
      target.z + radius * Math.sin(p) * Math.sin(theta),
    );
    this.camera.lookAt(target);
  }

  protected fit(): void {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (!W || !H) return;
    const dpr = devicePxRatioNumber(layoutDevicePxRatio());
    if (W === this.W && H === this.H && dpr === this.layoutDpr) return;
    this.W = W; this.H = H; this.layoutDpr = dpr;
    if (this.renderer) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
    }
    if (this.canvas) {
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
      if (this.fallback) {
        this.canvas.width = Math.round(W * dpr);
        this.canvas.height = Math.round(H * dpr);
        this.fallback.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  private ensureRenderer(): void {
    if (this.renderer || this.fallback) return;
    const canvas = document.createElement("canvas");
    this.canvas = canvas;
    this.container.appendChild(canvas);
    const ok = probeWebGL();
    if (ok) {
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      this.renderer = r;
    } else {
      this.fallback = canvas.getContext("2d");
    }
    this.fit();
  }

  private releaseRenderer(): void {
    const r = this.renderer;
    this.renderer = null;
    this.fallback = null;
    if (r) {
      r.forceContextLoss();
      r.dispose();
    }
    this.canvas?.remove();
    this.canvas = null;
  }

  private async poll(): Promise<void> {
    if (!this.useTraffic()) return;
    const q = this.query();
    if (!this.running || !q || !q.ip || this.inflight) return;
    this.inflight = true;
    const gen = this.gen;
    try {
      let url = `/api/traffic?ip=${encodeURIComponent(q.ip)}`;
      if (q.peer) url += `&peer=${encodeURIComponent(q.peer)}`;
      if (this.lastT) url += `&since=${this.lastT}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const m = (await r.json()) as TrafficMsg;
      if (gen !== this.gen) return;
      const pk = m.packets.slice().reverse();
      if (!pk.length) {
        this.pps *= 0.6;
        this.onTrafficPollEmpty();
        return;
      }
      const newest = pk[pk.length - 1]![0];
      if (this.lastT === 0) this.lastT = newest - REPLAY_S;
      const fresh = pk.filter((p) => p[0] > this.lastT);
      this.lastT = newest;
      this.pps = this.pps * 0.6 + (fresh.length / (POLL_MS / 1000)) * 0.4;
      if (fresh.length) this.ingest(fresh, fresh[0]![0], newest);
    } catch {
      // server away; the next tick retries
    } finally {
      if (gen === this.gen) this.inflight = false;
    }
  }

  private frame = (ts: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    markFrame(frameTsFromRaf(ts));
    this.paneFps.tick(ts);
    const now = ts / 1000;
    const dt = Math.min(0.05, this.lastFrame ? now - this.lastFrame : 0.016);
    this.lastFrame = now;
    this.fit();
    if (!this.W || !this.H) return;
    this.step(now, dt);
    this.applyCamera();
    if (this.renderer) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
      const draw = () => this.renderer?.render(this.world, this.camera);
      if (gl) {
        timeGpu(gl, draw, (ms) => this.paneFps.noteGpu(ms));
        const dev = deviceRect(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        const vp = toGlRectInto(
          dev,
          asCanvasDeviceHeight(gl.drawingBufferHeight),
          this.paneGlVpScratch,
        );
        this.picture.tick(gl, vp, ts, (at) => this.paneFps.mark(at));
      } else draw();
    } else if (this.fallback && this.canvas) {
      this.drawFallback(this.fallback, now);
      if (this.flatPicture.sample(this.fallback, this.canvas)) this.paneFps.mark(ts);
    }
  };

  private drawFallback(g: CanvasRenderingContext2D, now: number): void {
    g.fillStyle = "#0b1220";
    g.fillRect(0, 0, this.W, this.H);
    g.fillStyle = "#90caf9";
    g.font = "14px ui-sans-serif, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("WebGL unavailable — 3D stage idle", this.W / 2, this.H / 2 + Math.sin(now) * 4);
  }

  private onPtrDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastPtr = { x: e.clientX, y: e.clientY };
    this.container.setPointerCapture?.(e.pointerId);
  };
  private onPtrMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPtr.x, dy = e.clientY - this.lastPtr.y;
    this.lastPtr = { x: e.clientX, y: e.clientY };
    this.camOrbit.theta -= dx * 0.007;
    this.camOrbit.phi -= dy * 0.007;
  };
  private onPtrUp = (): void => { this.dragging = false; };
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.camOrbit.radius = clamp(this.camOrbit.radius * (1 + Math.sign(e.deltaY) * 0.08), 8, 120);
  };

  protected deviceAt(ip: string): Device | undefined {
    return this.scene.deviceOf(ip) ?? this.msg?.devices.find((d) => d.ip === ip);
  }

  protected nameOf(ip: string): string {
    const d = this.deviceAt(ip);
    const n = d ? displayName(d) : ip;
    return n === ip ? rIp(ip) : rName(n);
  }

  protected shortName(ip: string): string {
    const n = this.nameOf(ip);
    if (n === rIp(ip)) return n;
    return n.replace(/\.(local|lan|home|arpa)$/i, "");
  }

  protected colorOf(ip: string): number {
    const d = this.deviceAt(ip);
    if (d && d.role !== "internet" && d.role !== "lan") return this.theme.roles[d.role];
    return hashColor(ip);
  }

  protected roleColor(role: Role): number { return this.theme.roles[role]; }

  protected lanToken(): string {
    if (!this.msg) return "";
    return "@lan";
  }

  protected knownDevices(): Device[] {
    return (this.msg?.devices ?? []).filter((d) => isKnown(d) || d.role === "internet");
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export { isKnown, idsOf };
