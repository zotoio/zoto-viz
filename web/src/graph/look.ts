import * as THREE from "three";
import { Backdrop } from "./backdrop";
import { FloorGrid } from "./floor";
import type { DreamAnim, NetScene } from "./scene";
import { fadeTowardPole, type Theme } from "../core/themes";

const _grid = new THREE.Color();
const _fill = new THREE.Color();
const _gridMinor = new THREE.Color();
const _axis = new THREE.Vector3(0, 1, 0);

/**
 * Sky + floor behind an arcade canvas. Same Backdrop / FloorGrid shaders as the graph, driven from
 * the live NetScene so theme, tiles, and the audio pulse stay in lockstep. The 2D game draws on top.
 * The WebGL context is created on attach and released on detach so mosaic graph tiles are not starved.
 */
export class LookStage {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly world = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly backdrop = new Backdrop();
  private readonly grid = new FloorGrid();
  private readonly fog: THREE.FogExp2;
  private readonly rim: THREE.PointLight;
  private attached = false;
  private dreamT = 0;
  private lastW = 0;
  private lastH = 0;
  private lastDpr = 0;

  constructor(private readonly host: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 12000);
    this.camera.position.set(0, 820, 820);
    this.camera.lookAt(0, 0, 0);
    this.fog = new THREE.FogExp2(0x0b0e14, 0.00075);
    this.world.fog = this.fog;
    this.world.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(300, 500, 400);
    this.world.add(key);
    this.rim = new THREE.PointLight(0x7eb8ff, 4000, 0, 1.2);
    this.rim.position.set(-400, -200, -300);
    this.world.add(this.rim);
    this.world.add(this.backdrop.mesh);
    this.world.add(this.backdrop.liveMesh);
    this.world.add(this.grid.mesh);
  }

  attach(): void {
    if (this.attached) return;
    const r = this.ensure();
    this.host.prepend(r.domElement);
    this.attached = true;
    this.dreamT = 0;
    this.resize();
  }

  detach(): void {
    if (!this.attached && !this.renderer) return;
    this.attached = false;
    this.lastW = 0;
    this.lastH = 0;
    this.lastDpr = 0;
    this.release();
  }

  /** Pull sky / floor / camera from the graph scene and paint one frame. */
  frame(src: NetScene, theme: Theme, dt: number, now: number): void {
    if (!this.attached) return;
    const r = this.ensure();
    this.resize();
    this.apply(src.dreamAnim, theme, src.pulseNow, r);
    this.follow(src, dt);
    this.backdrop.tick(now);
    r.render(this.world, this.camera);
  }

  dispose(): void {
    this.detach();
  }

  private ensure(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
    r.domElement.className = "look";
    r.domElement.setAttribute("aria-hidden", "true");
    r.setClearColor(0x0b0e14);
    this.renderer = r;
    return r;
  }

  private release(): void {
    const r = this.renderer;
    if (!r) return;
    r.domElement.remove();
    r.forceContextLoss();
    r.dispose();
    this.renderer = null;
  }

  private apply(anim: DreamAnim, theme: Theme, pulse: { level: number; bass: number }, r: THREE.WebGLRenderer): void {
    const s = theme.scene;
    this.fog.density = anim.backdrop === "none" ? 0.00075 : 0.00022;
    this.rim.color.setHex(s.rim);
    this.backdrop.setKind(anim.backdrop);
    const raw = anim.bgColor ? _fill.set(anim.bgColor).getHex() : s.clear;
    const fill = fadeTowardPole(raw, anim.bgOpacity, theme.dark);
    const fogC = fadeTowardPole(anim.bgColor ? raw : s.fog, anim.bgOpacity, theme.dark);
    const skyP = anim.skyAudio ? pulse.level : 0;
    const skyB = anim.skyAudio ? pulse.bass : 0;
    const floorP = anim.gridAudio ? pulse.level : 0;
    const floorB = anim.gridAudio ? pulse.bass : 0;
    const op = Math.min(1, Math.max(0, anim.bgOpacity));
    if (anim.bgAudio) {
      const k = Math.min(1, pulse.bass);
      const clear = _fill.setHex(fill).lerp(_grid.setHex(s.rim), (0.08 + 0.52 * k) * op).getHex();
      r.setClearColor(clear);
      this.fog.color.setHex(fogC).lerp(_grid.setHex(s.rim), (0.06 + 0.42 * k) * op);
      this.backdrop.setColors(s.rim, clear);
    } else {
      r.setClearColor(fill);
      this.fog.color.setHex(fogC);
      this.backdrop.setColors(s.rim, fill);
    }
    this.backdrop.setLook(
      anim.skyAudio ? Math.min(1, anim.skyOpacity * (0.28 + 0.85 * skyP)) : anim.skyOpacity,
      anim.skyAudio ? anim.skyBright * (0.4 + 1.5 * skyB) : anim.skyBright,
      skyP,
    );
    this.backdrop.setMotion(anim.skySpeed, anim.skyEase);
    if (anim.gridColor) {
      _grid.set(anim.gridColor);
      this.grid.setColors(_grid.getHex(), _gridMinor.copy(_grid).multiplyScalar(0.55).getHex());
    } else {
      this.grid.setColors(s.gridMajor, s.gridMinor);
    }
    this.grid.setLook(
      anim.gridAudio ? Math.min(1, anim.gridOpacity * (0.28 + 0.85 * floorP)) : anim.gridOpacity,
      anim.gridAudio ? anim.gridBright * (0.4 + 1.5 * floorB) : anim.gridBright,
      floorP,
      anim.gridSize,
      anim.gridShape,
    );
  }

  private follow(src: NetScene, dt: number): void {
    this.camera.position.copy(src.camera.position);
    this.camera.quaternion.copy(src.camera.quaternion);
    if (src.isDreaming) {
      this.dreamT += dt;
      this.camera.position.applyAxisAngle(_axis, this.dreamT * 0.04);
      this.camera.lookAt(src.controls.target);
    }
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    if (w === this.lastW && h === this.lastH && dpr === this.lastDpr) return;
    this.lastW = w; this.lastH = h; this.lastDpr = dpr;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    r.setPixelRatio(dpr);
    r.setSize(w, h, false);
    this.backdrop.setViewport(w, h);
  }
}
