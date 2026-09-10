import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { forceCenter, forceLink, forceManyBody, forceRadial, forceSimulation, type Simulation, type SimNode, type SimLink } from "d3-force-3d";
import { ROLE_COLOR, displayName, fmtBytes, type Device, type Flow, type Role, type StateMsg } from "./types";

export interface Filters { internet: boolean; multicast: boolean; offline: boolean; labels: boolean }

interface GNode extends SimNode {
  id: string;
  device: Device;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: CSS2DObject;
  labelUntil?: number;
  labelEl: HTMLDivElement;
  visible: boolean;
  active: boolean;
  rate: number;
  targetScale: number;
}
interface GLink extends SimLink<GNode> { id: string; flow: Flow; source: GNode; target: GNode; visible: boolean }

const SHELL: Record<Role, number> = { self: 110, gateway: 0, local: 200, lan: 360, multicast: 440, internet: 580 };
const INTERNET_LABEL_MIN_RATE = 2000; // B/s before an internet node earns a persistent label
const INTERNET_LABEL_HOLD_S = 20;     // how long that label survives once the burst is over
const MAX_PARTICLES = 3000;

export class NetScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private nodes = new Map<string, GNode>();
  private links = new Map<string, GLink>();
  private sim: Simulation<GNode, GLink>;
  private linkForce = forceLink<GNode, GLink>().id((n) => n.id);
  private lines: THREE.LineSegments;
  private linePos: Float32Array;
  private lineCol: Float32Array;
  private particles: THREE.Points;
  private partPos: Float32Array;
  private partCol: Float32Array;
  private partState: { link: GLink; t: number; dir: 1 | -1; speed: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(2, 2);
  private hovered: GNode | null = null;
  private selected: GNode | null = null;
  private filters: Filters = { internet: true, multicast: false, offline: true, labels: true };
  private lastInteraction = performance.now();
  private now = Date.now() / 1000;
  onSelect: (d: Device | null) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0b0e14);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    Object.assign(this.labelRenderer.domElement.style, { position: "absolute", top: "0", pointerEvents: "none" });
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 1, 5000);
    this.camera.position.set(0, 820, 820);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("start", () => { this.lastInteraction = performance.now(); this.controls.autoRotate = false; });

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(300, 500, 400);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x4477ff, 4000, 0, 1.2);
    rim.position.set(-400, -200, -300);
    this.scene.add(rim);
    this.scene.fog = new THREE.FogExp2(0x0b0e14, 0.00075);

    // faint reference grid on the "floor"
    const grid = new THREE.GridHelper(1600, 32, 0x1a2030, 0x141a26);
    grid.position.y = -320;
    this.scene.add(grid);

    // edges
    this.linePos = new Float32Array(0);
    this.lineCol = new Float32Array(0);
    const lg = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);

    // traffic particles
    this.partPos = new Float32Array(MAX_PARTICLES * 3);
    this.partCol = new Float32Array(MAX_PARTICLES * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.partPos, 3));
    pg.setAttribute("color", new THREE.BufferAttribute(this.partCol, 3));
    pg.setDrawRange(0, 0);
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    // layout
    this.sim = forceSimulation<GNode, GLink>([], 3)
      .alphaDecay(0.006)
      .velocityDecay(0.35)
      .force("link", this.linkForce
        .distance((l) => (l.source.device.role === "internet" || l.target.device.role === "internet" ? 260 : 160))
        .strength((l) => (l.id.startsWith("~") ? 0.03
          : l.source.device.role === "multicast" || l.target.device.role === "multicast" ? 0 // hubs are informational only
          : 0.12)))
      .force("charge", forceManyBody<GNode>().strength((n) => (n.device.role === "lan" || n.device.role === "local" ? -500 : -90)).distanceMax(700))
      .force("center", forceCenter<GNode>(0, 0, 0).strength(0.02))
      .force("shell", forceRadial<GNode>((n) => SHELL[n.device.role]).strength((n) => (n.device.role === "gateway" ? 1 : n.device.role === "internet" || n.device.role === "multicast" ? 0.6 : 0.9)))
      .force("flatten", flattenLan(0.12))
      .stop();

    window.addEventListener("resize", () => this.resize());
    const setPointer = (e: PointerEvent | MouseEvent) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    this.renderer.domElement.addEventListener("pointermove", setPointer);
    this.renderer.domElement.addEventListener("pointerleave", () => this.pointer.set(2, 2));
    let downAt = 0, downX = 0, downY = 0;
    this.renderer.domElement.addEventListener("pointerdown", (e) => { downAt = performance.now(); downX = e.clientX; downY = e.clientY; });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      // a click is a short press without drag; pick from the release position (works for touch and synthetic clicks)
      if (performance.now() - downAt < 300 && Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
        setPointer(e);
        this.select(this.pick());
      }
    });
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setFilters(f: Partial<Filters>): void {
    Object.assign(this.filters, f);
    this.applyVisibility();
    this.syncSimulation(0.3);
  }

  select(n: GNode | null): void {
    this.selected = n;
    this.onSelect(n ? n.device : null);
    this.applyVisibility();
  }

  selectIp(ip: string): void {
    const n = this.nodes.get(ip);
    if (n) {
      this.select(n);
      this.controls.autoRotate = false;
      const target = new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0);
      this.controls.target.lerp(target, 1);
    }
  }

  // ------------------------------------------------------------------ data

  update(msg: StateMsg): void {
    this.now = msg.ts;
    let added = false;      // structural change: links appeared/disappeared
    let newNodes = 0;       // only new nodes justify warming the layout up
    const seen = new Set<string>();
    for (const d of msg.devices) {
      seen.add(d.ip);
      let n = this.nodes.get(d.ip);
      if (!n) { n = this.addNode(d, msg); added = true; newNodes++; }
      n.device = d;
      n.mesh.userData.device = d;
      const c = ROLE_COLOR[d.role];
      n.mesh.material.color.setHex(c);
      n.targetScale = this.sizeFor(d);
      this.setLabelText(n);
    }
    // devices that vanished from the snapshot (state reset) are removed
    for (const [ip, n] of this.nodes) if (!seen.has(ip)) this.removeNode(n);

    const liveKeys = new Set<string>();
    for (const f of msg.flows) {
      const id = `${f.a}|${f.b}`;
      liveKeys.add(id);
      let l = this.links.get(id);
      const a = this.nodes.get(f.a), b = this.nodes.get(f.b);
      if (!a || !b) continue;
      if (!l) {
        l = { id, flow: f, source: a, target: b, visible: true };
        this.links.set(id, l);
        added = true;
      } else l.flow = f;
    }
    for (const id of [...this.links.keys()]) if (!id.startsWith("~") && !liveKeys.has(id)) this.links.delete(id);

    // tether nodes without an observed conversation to their hub ("~" links): LAN and self -> gateway,
    // local (Docker / VM / tunnel subnets) -> this host. The layout then reads as a star even when only
    // broadcast traffic is visible.
    const gw = this.nodes.get(msg.gateway);
    const me = this.nodes.get(msg.local_ip);
    if (gw) gw.fx = gw.fy = gw.fz = 0;
    const hubFor = (n: GNode): GNode | undefined =>
      n.device.role === "lan" || n.device.role === "self" ? gw : n.device.role === "local" ? me : undefined;
    const realLinks = new Set<string>();
    for (const l of this.links.values()) {
      if (l.id.startsWith("~")) continue;
      realLinks.add(`${l.source.id}|${l.target.id}`);
      realLinks.add(`${l.target.id}|${l.source.id}`);
    }
    for (const n of this.nodes.values()) {
      const tetherId = `~${n.id}`;
      const hub = hubFor(n);
      const wants = hub !== undefined && hub !== n && !realLinks.has(`${n.id}|${hub.id}`);
      const existing = this.links.get(tetherId);
      if (wants && (!existing || existing.target !== hub)) {
        const flow: Flow = { a: n.id, b: hub.id, bytes: 0, packets: 0, ports: [], protos: [], ifaces: [], first_seen: 0, last_seen: 0, rate: 0 };
        this.links.set(tetherId, { id: tetherId, flow, source: n, target: hub, visible: true });
        added = true;
      } else if (!wants && existing) {
        this.links.delete(tetherId);
      }
    }
    for (const n of this.nodes.values()) { n.active = false; n.rate = 0; }
    for (const l of this.links.values()) {
      if (l.flow.rate > 0) {
        l.source.active = l.target.active = true;
        l.source.rate += l.flow.rate;
        l.target.rate += l.flow.rate;
      }
    }

    this.applyVisibility();
    if (added) this.syncSimulation(newNodes > 0 ? (this.nodes.size <= newNodes + 1 ? 1 : 0.12) : 0);
    this.rebuildLineBuffers();
    this.rebuildParticles();
    if (this.selected) this.onSelect(this.selected.device);
  }

  /** Only visible nodes and links take part in the layout, so hidden multicast hubs cannot bunch LAN devices. */
  private syncSimulation(minAlpha: number): void {
    this.sim.nodes([...this.nodes.values()].filter((n) => n.visible));
    this.linkForce.links([...this.links.values()].filter((l) => l.visible));
    if (minAlpha > 0) this.sim.alpha(Math.max(this.sim.alpha(), minAlpha));
  }

  private sizeFor(d: Device): number {
    if (d.role === "multicast") return 3;
    const base = d.role === "gateway" ? 10 : d.role === "self" ? 7 : 5;
    return base + Math.min(5, Math.log10(1 + d.bytes_in + d.bytes_out) * 0.45);
  }

  private addNode(d: Device, msg: StateMsg): GNode {
    const geo = new THREE.SphereGeometry(1, 24, 18);
    const mat = new THREE.MeshStandardMaterial({ color: ROLE_COLOR[d.role], roughness: 0.35, metalness: 0.15, emissive: ROLE_COLOR[d.role], emissiveIntensity: 0.15, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    const el = document.createElement("div");
    el.className = "label";
    const label = new CSS2DObject(el);
    label.position.set(0, 1.9, 0);
    mesh.add(label);
    // spawn on the role's shell, in the direction of its first known peer so it slides in rather than flying across
    const shell = SHELL[d.role];
    const peerIp = msg.flows.find((f) => f.a === d.ip || f.b === d.ip);
    const peer = peerIp ? this.nodes.get(peerIp.a === d.ip ? peerIp.b : peerIp.a) : undefined;
    let dir = new THREE.Vector3(peer?.x ?? 0, peer?.y ?? 0, peer?.z ?? 0);
    if (dir.lengthSq() < 1) dir = new THREE.Vector3().randomDirection();
    dir.normalize().add(new THREE.Vector3().randomDirection().multiplyScalar(0.35)).normalize();
    if (d.role === "lan" || d.role === "local" || d.role === "self") dir.y *= 0.2;
    dir.normalize().multiplyScalar(shell || 1);
    const n: GNode = {
      id: d.ip, device: d, mesh, label, labelEl: el, visible: true, active: false, rate: 0, targetScale: this.sizeFor(d),
      x: dir.x, y: dir.y, z: dir.z,
    };
    mesh.userData.node = n;
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    this.nodes.set(d.ip, n);
    this.setLabelText(n);
    return n;
  }

  private removeNode(n: GNode): void {
    this.scene.remove(n.mesh);
    n.mesh.geometry.dispose();
    n.mesh.material.dispose();
    n.labelEl.remove();
    this.nodes.delete(n.id);
    for (const [id, l] of this.links) if (l.source === n || l.target === n) this.links.delete(id);
    if (this.selected === n) this.select(null);
  }

  private setLabelText(n: GNode): void {
    const d = n.device;
    const name = displayName(d);
    const sub = name === d.ip ? (d.vendor || "") : d.ip + (d.vendor ? ` · ${d.vendor}` : "");
    const html = `${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}`;
    if (n.labelEl.innerHTML !== html) n.labelEl.innerHTML = html;
    n.labelEl.classList.toggle("dim", !d.online);
  }

  private nodeVisible(n: GNode): boolean {
    const d = n.device;
    if (d.role === "internet" && !this.filters.internet) return false;
    if (d.role === "multicast" && !this.filters.multicast) return false;
    if (!d.online && !this.filters.offline && d.role !== "gateway" && d.role !== "self") return false;
    return true;
  }

  private applyVisibility(): void {
    for (const n of this.nodes.values()) {
      n.visible = this.nodeVisible(n);
      n.mesh.visible = n.visible;
      const r = n.device.role;
      if (n.rate >= INTERNET_LABEL_MIN_RATE) n.labelUntil = this.now + INTERNET_LABEL_HOLD_S; // hysteresis: earned labels linger
      const showLabel = n.visible && this.filters.labels && (
        n === this.selected || n === this.hovered ||
        r === "lan" || r === "local" || r === "self" || r === "gateway" ||
        (r === "internet" && (n.labelUntil ?? 0) > this.now)
      );
      n.label.visible = showLabel; // CSS2DRenderer owns element.style.display; drive it via object visibility
    }
    for (const l of this.links.values()) l.visible = l.source.visible && l.target.visible;
  }

  // ------------------------------------------------------------------ buffers

  private rebuildLineBuffers(): void {
    const n = this.links.size;
    if (this.linePos.length !== n * 6) {
      this.linePos = new Float32Array(n * 6);
      this.lineCol = new Float32Array(n * 6);
      this.lines.geometry.setAttribute("position", new THREE.BufferAttribute(this.linePos, 3));
      this.lines.geometry.setAttribute("color", new THREE.BufferAttribute(this.lineCol, 3));
    }
  }

  private rebuildParticles(): void {
    // particle budget proportional to sqrt(rate) per link, capped globally
    const wanted: { link: GLink; count: number }[] = [];
    let total = 0;
    for (const l of this.links.values()) {
      if (l.flow.rate <= 0) continue;
      const c = Math.min(40, 1 + Math.floor(Math.sqrt(l.flow.rate / 200)));
      wanted.push({ link: l, count: c });
      total += c;
    }
    const scale = total > MAX_PARTICLES ? MAX_PARTICLES / total : 1;
    const existing = new Map<GLink, { link: GLink; t: number; dir: 1 | -1; speed: number }[]>();
    for (const p of this.partState) {
      if (!this.links.has(p.link.id)) continue;
      (existing.get(p.link) ?? existing.set(p.link, []).get(p.link)!).push(p);
    }
    const next: typeof this.partState = [];
    for (const { link, count } of wanted) {
      const c = Math.max(1, Math.round(count * scale));
      const have = existing.get(link) ?? [];
      for (let i = 0; i < c; i++) {
        next.push(have[i] ?? { link, t: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: 0.25 + Math.random() * 0.35 });
      }
    }
    this.partState = next;
  }

  // ------------------------------------------------------------------ frame

  private clock = new THREE.Clock();

  private animate(): void {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());

    if (this.sim.alpha() > 0.003) this.sim.tick();
    else this.sim.alpha(0.003); // keep a gentle drift so new nodes always settle

    // nodes
    for (const n of this.nodes.values()) {
      n.mesh.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0);
      const target = n.visible ? n.targetScale : 0.01;
      const s = n.mesh.scale.x + (target - n.mesh.scale.x) * Math.min(1, dt * 6);
      n.mesh.scale.setScalar(s);
      const m = n.mesh.material;
      const boost = n === this.selected ? 1.1 : n === this.hovered ? 0.7 : n.active ? 0.45 : 0.12;
      m.emissiveIntensity += (boost - m.emissiveIntensity) * Math.min(1, dt * 8);
      const targetOpacity = n.device.online ? 1 : 0.35;
      m.opacity += (targetOpacity - m.opacity) * Math.min(1, dt * 4);
    }

    // edges
    let i = 0;
    const sel = this.selected;
    const tmp = new THREE.Color();
    for (const l of this.links.values()) {
      const a = l.source, b = l.target;
      this.linePos[i] = a.x ?? 0; this.linePos[i + 1] = a.y ?? 0; this.linePos[i + 2] = a.z ?? 0;
      this.linePos[i + 3] = b.x ?? 0; this.linePos[i + 4] = b.y ?? 0; this.linePos[i + 5] = b.z ?? 0;
      let bright: number;
      if (!l.visible) bright = 0;
      else if (l.id.startsWith("~")) bright = 0.08;
      else if (l.flow.rate > 0) bright = 0.35 + Math.min(0.65, Math.log10(1 + l.flow.rate) / 6);
      else bright = 0.14;
      if (sel && (a === sel || b === sel)) bright = Math.max(bright, 0.9);
      else if (sel) bright *= 0.35;
      const isLan = a.device.role !== "internet" && b.device.role !== "internet";
      tmp.setHex(l.id.startsWith("~") ? 0x3a4256 : isLan ? 0x5aa9ff : 0xc97bff).multiplyScalar(bright);
      this.lineCol[i] = tmp.r; this.lineCol[i + 1] = tmp.g; this.lineCol[i + 2] = tmp.b;
      this.lineCol[i + 3] = tmp.r; this.lineCol[i + 4] = tmp.g; this.lineCol[i + 5] = tmp.b;
      i += 6;
    }
    const pa = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const ca = this.lines.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (pa && ca) { pa.needsUpdate = true; ca.needsUpdate = true; }

    // particles
    let k = 0;
    for (const p of this.partState) {
      if (k >= MAX_PARTICLES) break;
      if (!p.link.visible) continue;
      p.t += p.dir * p.speed * dt;
      if (p.t > 1 || p.t < 0) { p.t = p.dir > 0 ? 0 : 1; }
      const a = p.link.source, b = p.link.target;
      const t = p.t;
      this.partPos[k * 3] = (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * t;
      this.partPos[k * 3 + 1] = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t;
      this.partPos[k * 3 + 2] = (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t;
      const isLan = a.device.role !== "internet" && b.device.role !== "internet";
      tmp.setHex(isLan ? 0x9fd0ff : 0xe6b3ff);
      this.partCol[k * 3] = tmp.r; this.partCol[k * 3 + 1] = tmp.g; this.partCol[k * 3 + 2] = tmp.b;
      k++;
    }
    this.particles.geometry.setDrawRange(0, k);
    (this.particles.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.particles.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    // hover
    const h = this.pick();
    if (h !== this.hovered) {
      this.hovered = h;
      this.renderer.domElement.style.cursor = h ? "pointer" : "";
      this.applyVisibility();
    }

    if (!this.controls.autoRotate && performance.now() - this.lastInteraction > 20000 && !this.selected) this.controls.autoRotate = true;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  private pick(): GNode | null {
    if (this.pointer.x > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes: THREE.Mesh[] = [];
    for (const n of this.nodes.values()) if (n.visible) meshes.push(n.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? (hits[0].object.userData.node as GNode) : null;
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  get currentTime(): number { return this.now; }
  peersOf(ip: string): Flow[] {
    return [...this.links.values()].filter((l) => !l.id.startsWith("~") && (l.flow.a === ip || l.flow.b === ip)).map((l) => l.flow)
      .sort((x, y) => y.rate - x.rate || y.bytes - x.bytes);
  }
  deviceOf(ip: string): Device | undefined { return this.nodes.get(ip)?.device; }
}

/** Pull LAN/self nodes toward the y=0 plane so they form a ring around the gateway; internet nodes stay spherical. */
function flattenLan(strength: number) {
  let nodes: GNode[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) {
      const r = n.device.role;
      if (r === "lan" || r === "self" || r === "local") n.vy = (n.vy ?? 0) - (n.y ?? 0) * strength * alpha;
    }
  };
  force.initialize = (ns: GNode[]) => { nodes = ns; };
  return force;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export { fmtBytes };
