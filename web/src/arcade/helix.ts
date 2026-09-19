import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { helixPoint, lerp3 } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeNucleotide } from "./models3d";
import type { Device, Packet } from "../core/types";

const KEY_WHO = "zoto-viz.helix.who";

/** Animated double-helix graph: devices are nucleotides, packets zip the rungs. */
export class HelixView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly actors = new Map<string, THREE.Group>();
  private readonly rungs: THREE.Mesh[] = [];
  private readonly backbone = new THREE.Group();
  private zippers: { mesh: THREE.Mesh; t0: number; i: number }[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "helixWho", caption: "strand", key: KEY_WHO,
      title: "whose traffic walks the helix",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 32;
    this.camOrbit.phi = 1.25;
    this.camOrbit.target.set(0, 0, 0);
    this.root.add(this.backbone);
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4.6, 0.4, 32),
      new THREE.MeshStandardMaterial({ color: 0x37474f, metalness: 0.3, roughness: 0.5 }),
    );
    ped.position.y = -15;
    this.root.add(ped);
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
    list.forEach((d) => {
      keep.add(d.ip);
      if (!this.actors.has(d.ip)) {
        const g = makeNucleotide(this.colorOf(d.ip));
        this.actors.set(d.ip, g);
        this.root.add(g);
      }
    });
    for (const [ip, g] of this.actors) {
      if (keep.has(ip)) continue;
      g.removeFromParent();
      this.actors.delete(ip);
    }
    this.rebuildRungs(list.length);
  }

  protected ingest(fresh: Packet[]): void {
    for (const _p of fresh.slice(-12)) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x80deea, emissive: 0x00acc1, emissiveIntensity: 0.9 }),
      );
      this.root.add(mesh);
      this.zippers.push({ mesh, t0: performance.now() / 1000, i: this.zippers.length });
    }
  }

  protected step(now: number, dt: number): void {
    const list = this.ranked();
    const n = Math.max(1, list.length);
    list.forEach((d, i) => {
      const g = this.actors.get(d.ip);
      if (!g) return;
      const strand: 0 | 1 = (i % 2) as 0 | 1;
      const [x, y, z] = helixPoint(Math.floor(i / 2), Math.ceil(n / 2), strand, 4);
      const wobble = Math.sin(now * 1.4 + i) * 0.15;
      g.position.set(x + wobble, y, z);
      g.lookAt(0, y, 0);
      g.scale.setScalar(0.85 + Math.min(0.5, Math.log10(1 + d.packets) / 10));
    });
    const half = Math.ceil(n / 2);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    this.rungs.forEach((r, i) => {
      if (i >= half) { r.visible = false; return; }
      r.visible = true;
      const a = helixPoint(i, half, 0, 4);
      const b = helixPoint(i, half, 1, 4);
      r.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const len = dir.length();
      if (len < 0.05) { r.visible = false; return; }
      r.quaternion.setFromUnitVectors(yAxis, dir.multiplyScalar(1 / len));
      r.scale.set(0.16, len, 0.16);
    });
    this.zippers = this.zippers.filter((z) => {
      const u = (now - z.t0) / 2.4;
      if (u >= 1) { z.mesh.removeFromParent(); return false; }
      const i = Math.floor(u * Math.max(1, half - 1));
      const a = helixPoint(i, half, 0, 4);
      const b = helixPoint(Math.min(half - 1, i + 1), half, 1, 4);
      const p = lerp3(a, b, (u * half) % 1);
      z.mesh.position.set(p[0], p[1], p[2]);
      return true;
    });
    this.camOrbit.theta += dt * 0.1;
    this.camOrbit.target.y = Math.sin(now * 0.25) * 4;
  }

  private ranked(): Device[] {
    return this.knownDevices()
      .filter((d) => d.role !== "multicast")
      .sort((a, b) => b.packets - a.packets || a.ip.localeCompare(b.ip))
      .slice(0, 28);
  }

  private rebuildRungs(n: number): void {
    const need = Math.ceil(Math.max(1, n) / 2);
    while (this.rungs.length < need) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
        new THREE.MeshStandardMaterial({ color: 0xeceff1, metalness: 0.15, roughness: 0.35 }),
      );
      this.backbone.add(m);
      this.rungs.push(m);
    }
  }
}
