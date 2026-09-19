import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { hashUnit, skylineHeight } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeBuilding } from "./models3d";
import type { Device, Packet } from "../core/types";

const KEY_WHO = "zoto-viz.skyline.who";

/** Animated 3D city: each talker is a tower; height and window glow follow rate. */
export class SkylineView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly actors = new Map<string, { g: THREE.Group; h: number }>();
  private pulses: { mesh: THREE.Mesh; t0: number; x: number; z: number }[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "skylineWho", caption: "city", key: KEY_WHO,
      title: "whose traffic raises the towers",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 32;
    this.camOrbit.phi = 1.22;
    this.camOrbit.target.set(0, 4, 0);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(36, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a2332, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 70),
      new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.7 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    this.root.add(road);
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
        const g = makeBuilding(this.colorOf(d.ip), skylineHeight(0, d.packets));
        this.actors.set(d.ip, { g, h: 1 });
        this.root.add(g);
      }
    });
    for (const [ip, row] of this.actors) {
      if (keep.has(ip)) continue;
      row.g.removeFromParent();
      this.actors.delete(ip);
    }
  }

  protected ingest(fresh: Packet[]): void {
    for (const p of fresh.slice(-20)) {
      const d = this.deviceAt(p[9] ?? "") ?? this.deviceAt(p[2]);
      const [x, , z] = this.slot(d?.ip ?? p[2]);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xfff59d, emissive: 0xffee58, emissiveIntensity: 0.9 }),
      );
      mesh.position.set(x, 0.3, z);
      this.root.add(mesh);
      this.pulses.push({ mesh, t0: performance.now() / 1000, x, z });
    }
  }

  protected step(now: number, dt: number): void {
    const list = this.ranked();
    list.forEach((d, i) => {
      const row = this.actors.get(d.ip);
      if (!row) return;
      const target = skylineHeight(this.rateOf(d), d.packets);
      row.h += (target - row.h) * Math.min(1, dt * 2.2);
      const [x, , z] = this.slot(d.ip, i);
      row.g.position.set(x, 0, z);
      row.g.scale.set(1, row.h / 8, 1);
      row.g.rotation.y = hashUnit(d.ip) * 0.4;
    });
    this.pulses = this.pulses.filter((p) => {
      const u = (now - p.t0) / 1.2;
      if (u >= 1) { p.mesh.removeFromParent(); return false; }
      p.mesh.position.y = 0.3 + u * 10;
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - u;
      (p.mesh.material as THREE.MeshStandardMaterial).transparent = true;
      return true;
    });
    this.camOrbit.theta += dt * 0.07;
  }

  private ranked(): Device[] {
    return this.knownDevices()
      .filter((d) => d.role !== "multicast")
      .sort((a, b) => b.packets - a.packets)
      .slice(0, 32);
  }

  private rateOf(d: Device): number {
    const flows = this.msg?.flows ?? [];
    let r = 0;
    for (const f of flows) if (f.a === d.ip || f.b === d.ip) r += f.rate;
    return r;
  }

  private slot(ip: string, index = 0): [number, number, number] {
    const col = (index % 8) - 3.5;
    const row = Math.floor(index / 8) - 1.5;
    const jx = (hashUnit(ip, 1) - 0.5) * 0.6;
    const jz = (hashUnit(ip, 2) - 0.5) * 0.6;
    return [col * 3.2 + jx, 0, row * 3.2 + jz];
  }
}
