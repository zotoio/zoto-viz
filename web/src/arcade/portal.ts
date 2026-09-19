import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { portalTravel } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeCompanionCube, makeEnergyOrb, makePanel, makePortalRing, makeTurret } from "./models3d";
import type { Device, Packet } from "../core/types";

const KEY_WHO = "zoto-viz.portal.who";
const ORANGE = 0xff6d00;
const BLUE = 0x29b6f6;

/** Two test chambers: LAN and internet, linked by orange/blue portals. Packets cross as energy orbs. */
export class PortalView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly lanActors = new Map<string, THREE.Group>();
  private readonly wanActors = new Map<string, THREE.Group>();
  private readonly portalA: THREE.Group;
  private readonly portalB: THREE.Group;
  private readonly cube: THREE.Group;
  private orbs: { mesh: THREE.Mesh; t0: number; from: [number, number, number]; to: [number, number, number]; out: boolean }[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "portalWho", caption: "chambers", key: KEY_WHO,
      title: "whose traffic crosses the portals",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 20;
    this.camOrbit.phi = 1.32;
    this.camOrbit.theta = Math.PI / 2;
    this.camOrbit.target.set(0, 1.8, 0);
    this.buildChambers();
    this.portalA = makePortalRing(ORANGE);
    this.portalA.position.set(-8.6, 2.2, 0);
    this.portalA.rotation.y = Math.PI / 2;
    this.portalB = makePortalRing(BLUE);
    this.portalB.position.set(8.6, 2.2, 0);
    this.portalB.rotation.y = -Math.PI / 2;
    this.root.add(this.portalA, this.portalB);
    this.cube = makeCompanionCube();
    this.cube.position.set(-4.5, 0.55, 1.4);
    this.root.add(this.cube);
  }

  protected query() {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
    const lan = this.knownDevices().filter((d) => d.role !== "internet" && d.role !== "multicast").slice(0, 8);
    const wan = this.knownDevices().filter((d) => d.role === "internet").slice(0, 8);
    this.syncSide(this.lanActors, lan, -4.2, false);
    this.syncSide(this.wanActors, wan, 4.2, true);
  }

  protected ingest(fresh: Packet[]): void {
    for (const p of fresh.slice(-14)) {
      const outbound = p[1] === "out";
      const from: [number, number, number] = outbound ? [-5.2, 1.1, (hash(p[2]) - 0.5) * 4] : [5.2, 1.1, (hash(p[2]) - 0.5) * 4];
      const to: [number, number, number] = outbound ? [5.2, 1.1, (hash(p[2] + "t") - 0.5) * 4] : [-5.2, 1.1, (hash(p[2] + "t") - 0.5) * 4];
      const mesh = makeEnergyOrb(outbound ? ORANGE : BLUE);
      this.root.add(mesh);
      this.orbs.push({ mesh, t0: performance.now() / 1000, from, to, out: outbound });
    }
  }

  protected step(now: number, dt: number): void {
    this.portalA.rotation.z = now * 1.6;
    this.portalB.rotation.z = -now * 1.6;
    this.cube.rotation.y = now * 0.4;
    this.cube.position.y = 0.55 + Math.sin(now * 1.3) * 0.08;
    const a: [number, number, number] = [this.portalA.position.x, this.portalA.position.y, this.portalA.position.z];
    const b: [number, number, number] = [this.portalB.position.x, this.portalB.position.y, this.portalB.position.z];
    this.orbs = this.orbs.filter((o) => {
      const u = (now - o.t0) / 1.8;
      if (u >= 1) { o.mesh.removeFromParent(); return false; }
      const p = o.out ? portalTravel(o.from, a, b, o.to, u) : portalTravel(o.from, b, a, o.to, u);
      o.mesh.position.set(p[0], p[1], p[2]);
      o.mesh.scale.setScalar(0.7 + Math.sin(u * Math.PI) * 0.5);
      return true;
    });
    this.camOrbit.theta = Math.PI / 2 + Math.sin(now * 0.22) * 0.28;
  }

  private syncSide(map: Map<string, THREE.Group>, list: Device[], cx: number, turrets: boolean): void {
    const keep = new Set<string>();
    list.forEach((d, i) => {
      keep.add(d.ip);
      if (!map.has(d.ip)) {
        const g = turrets ? makeTurret(this.colorOf(d.ip)) : (d.role === "gateway" ? makeCompanionCube() : makeTurret(this.colorOf(d.ip)));
        map.set(d.ip, g);
        this.root.add(g);
      }
      const g = map.get(d.ip)!;
      const col = (i % 3) - 1;
      const row = Math.floor(i / 3) - 0.5;
      g.position.set(cx + col * 1.6, 0, row * 1.8);
    });
    for (const [ip, g] of map) {
      if (keep.has(ip)) continue;
      g.removeFromParent();
      map.delete(ip);
    }
  }

  private buildChambers(): void {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.25, 14),
      new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.7 }),
    );
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    this.root.add(floor);
    const divider = makePanel(0.35, 6.2, 13, 0x455a64, 0x263238);
    divider.position.set(0, 3.1, 0);
    this.root.add(divider);
    for (const x of [-13.6, 13.6]) {
      const wall = makePanel(0.3, 6.2, 13, 0xeceff1, 0x90a4ae);
      wall.position.set(x, 3.1, 0);
      this.root.add(wall);
    }
    const back = makePanel(28, 6.2, 0.3, 0xe8e6e1, 0x78909c);
    back.position.set(0, 3.1, -6.6);
    this.root.add(back);
    const lampL = new THREE.PointLight(ORANGE, 1.1, 18);
    lampL.position.set(-7, 5.2, 0);
    const lampR = new THREE.PointLight(BLUE, 1.1, 18);
    lampR.position.set(7, 5.2, 0);
    this.root.add(lampL, lampR);
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 3)) % 997;
  return h / 997;
}
