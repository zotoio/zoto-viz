import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { gerstner, hashUnit } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeBuoy, makeIsland, makeLighthouse, makeShip } from "./models3d";
import type { Device, Packet } from "../core/types";

const KEY_WHO = "zoto-viz.waves.who";
const SEG = 72;

/**
 * Ocean field: LAN craft ride Gerstner waves. Amplitude follows packet rate.
 * Gateway is a lighthouse, this host a ship, LAN devices buoys, internet hosts islands.
 */
export class WavesView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly water: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly base: Float32Array;
  private readonly actors = new Map<string, THREE.Group>();
  private sea = 1.2;
  private splash: { x: number; z: number; t0: number; amp: number }[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "wavesWho", caption: "waters", key: KEY_WHO,
      title: "whose traffic drives the sea state",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 28;
    this.camOrbit.phi = 1.28;
    this.camOrbit.target.set(0, 1.4, 0);

    const geo = new THREE.PlaneGeometry(80, 80, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    this.pos = geo.attributes.position!.array as Float32Array;
    this.base = this.pos.slice();
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1565c0, roughness: 0.18, metalness: 0.08, transmission: 0.15,
      transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.root.add(this.water);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(48, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d2137, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    this.root.add(floor);
  }

  protected query() {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
    const keep = new Set<string>();
    const devices = this.knownDevices().filter((d) => d.role !== "multicast");
    const wan = devices.filter((d) => d.role === "internet").sort((a, b) => b.packets - a.packets).slice(0, 10);
    const rest = devices.filter((d) => d.role !== "internet");
    for (const d of [...rest, ...wan]) {
      keep.add(d.ip);
      if (!this.actors.has(d.ip)) {
        const g = this.modelFor(d);
        this.actors.set(d.ip, g);
        this.root.add(g);
      }
    }
    for (const [ip, g] of this.actors) {
      if (keep.has(ip)) continue;
      g.removeFromParent();
      this.actors.delete(ip);
    }
  }

  protected ingest(fresh: Packet[]): void {
    for (const p of fresh.slice(-24)) {
      const who = p[2];
      const slot = this.slotOf(who);
      this.splash.push({ x: slot[0], z: slot[2], t0: performance.now() / 1000, amp: 0.35 + Math.min(0.8, p[5] / 800) });
    }
  }

  protected step(now: number, dt: number): void {
    this.sea += ((0.7 + Math.min(2.4, this.pps / 40)) - this.sea) * Math.min(1, dt * 2);
    const amp = this.sea;
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = this.base[i]!, z = this.base[i + 2]!;
      const [dx, y, dz] = gerstner(x, z, now, amp);
      let extra = 0;
      for (const s of this.splash) {
        const age = now - s.t0;
        if (age > 2.4) continue;
        const dxs = x - s.x, dzs = z - s.z;
        const dist = Math.hypot(dxs, dzs);
        extra += s.amp * Math.sin(dist * 1.6 - age * 6) * Math.exp(-age * 1.3) * Math.exp(-dist * 0.12);
      }
      this.pos[i] = x + dx;
      this.pos[i + 1] = y + extra;
      this.pos[i + 2] = z + dz;
    }
    this.water.geometry.attributes.position!.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    this.splash = this.splash.filter((s) => now - s.t0 < 2.5);

    let i = 0;
    for (const [ip, g] of this.actors) {
      const d = this.deviceAt(ip);
      const [x, , z] = this.slotOf(ip, i++);
      const [, y] = gerstner(x, z, now, amp);
      g.position.set(x, Math.max(0.05, y) + (d?.role === "internet" ? 0.2 : 0), z);
      g.rotation.y = now * (0.08 + hashUnit(ip) * 0.12);
      g.rotation.z = y * 0.05;
    }
    this.camOrbit.theta += dt * 0.08;
  }

  private modelFor(d: Device): THREE.Group {
    const c = this.colorOf(d.ip);
    if (d.role === "gateway") return makeLighthouse(c);
    if (d.role === "self") return makeShip(c);
    if (d.role === "internet") return makeIsland(c);
    return makeBuoy(c);
  }

  private slotOf(ip: string, index = 0): [number, number, number] {
    const d = this.deviceAt(ip);
    const ring = d?.role === "gateway" ? 0 : d?.role === "self" ? 5 : d?.role === "internet" ? 18 : 9;
    const a = hashUnit(ip) * Math.PI * 2 + index * 0.4;
    return [Math.cos(a) * ring, 0, Math.sin(a) * (ring * 0.85)];
  }

  protected reset(): void {
    super.reset();
    this.splash = [];
  }
}
