import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { orbitPhase, orbitRadius } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makePlanet, makeSatellite, makeSun } from "./models3d";
import type { Device, Packet } from "../core/types";

const KEY_WHO = "zoto-viz.orbits.who";

/** Solar-system graph: gateway sun, LAN satellites, internet outer planets. */
export class OrbitsView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly actors = new Map<string, THREE.Group>();
  private readonly trails = new Map<string, THREE.Line>();
  private readonly rings = new THREE.Group();
  private sparks: { mesh: THREE.Mesh; t0: number; from: string; to: string }[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "orbitsWho", caption: "system", key: KEY_WHO,
      title: "whose traffic lights the orbits",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 38;
    this.camOrbit.phi = 1.22;
    this.root.add(this.rings);
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(240 * 3);
    for (let i = 0; i < starPos.length; i += 3) {
      const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
      const r = 70 + Math.random() * 40;
      starPos[i] = r * Math.sin(b) * Math.cos(a);
      starPos[i + 1] = r * Math.cos(b) * 0.4;
      starPos[i + 2] = r * Math.sin(b) * Math.sin(a);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.root.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18 })));
  }

  protected query() {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
    const list = this.ranked();
    const keep = new Set<string>();
    this.rings.clear();
    const seenR = new Set<number>();
    list.forEach((d, i) => {
      keep.add(d.ip);
      const r = orbitRadius(d.role, i, list.length);
      if (r > 1 && !seenR.has(Math.round(r))) {
        seenR.add(Math.round(r));
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.035, 8, 96),
          new THREE.MeshStandardMaterial({ color: 0x455a64, transparent: true, opacity: 0.35, metalness: 0.2 }),
        );
        ring.rotation.x = Math.PI / 2;
        this.rings.add(ring);
      }
      let g = this.actors.get(d.ip);
      if (!g) {
        g = this.modelFor(d);
        this.actors.set(d.ip, g);
        this.root.add(g);
      }
    });
    for (const [ip, g] of this.actors) {
      if (keep.has(ip)) continue;
      g.removeFromParent();
      this.actors.delete(ip);
      this.trails.get(ip)?.removeFromParent();
      this.trails.delete(ip);
    }
  }

  protected ingest(fresh: Packet[]): void {
    for (const p of fresh.slice(-16)) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffecb3, emissive: 0xffc107, emissiveIntensity: 0.8 }),
      );
      this.root.add(mesh);
      this.sparks.push({ mesh, t0: performance.now() / 1000, from: p[9] ?? this.msg?.local_ip ?? "", to: p[2] });
    }
  }

  protected step(now: number, dt: number): void {
    const list = this.ranked();
    list.forEach((d, i) => {
      const g = this.actors.get(d.ip);
      if (!g) return;
      const r = orbitRadius(d.role, i, list.length);
      const speed = 0.12 + Math.min(0.8, (d.packets % 1000) / 400) + Math.min(0.5, this.pps / 80);
      const a = orbitPhase(d.ip, i) + now * speed * (d.role === "internet" ? 0.35 : 1);
      const y = d.role === "gateway" ? 0 : Math.sin(a * 1.7) * 1.2;
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      g.rotation.y = a + now;
      const s = d.role === "gateway" ? 1.15 : d.role === "self" ? 0.95 : 0.7 + Math.min(0.6, Math.log10(1 + d.packets) / 8);
      g.scale.setScalar(s);
    });
    const t = now;
    this.sparks = this.sparks.filter((s) => {
      const u = (t - s.t0) / 1.6;
      if (u >= 1) { s.mesh.removeFromParent(); return false; }
      const a = this.actors.get(s.from)?.position ?? new THREE.Vector3();
      const b = this.actors.get(s.to)?.position ?? new THREE.Vector3();
      s.mesh.position.lerpVectors(a, b, u);
      return true;
    });
    this.camOrbit.theta += dt * 0.06;
  }

  private ranked(): Device[] {
    return this.knownDevices()
      .filter((d) => d.role !== "multicast")
      .sort((a, b) => roleRank(a.role) - roleRank(b.role) || b.packets - a.packets)
      .slice(0, 36);
  }

  private modelFor(d: Device): THREE.Group {
    const c = this.colorOf(d.ip);
    if (d.role === "gateway") return makeSun(c);
    if (d.role === "internet") return makePlanet(c, hashUnitish(d.ip));
    return makeSatellite(c);
  }
}

function roleRank(r: string): number {
  if (r === "gateway") return 0;
  if (r === "self") return 1;
  if (r === "lan" || r === "local") return 2;
  return 3;
}

function hashUnitish(s: string): boolean {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 97;
  return h % 3 === 0;
}
