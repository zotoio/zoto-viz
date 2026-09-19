import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { buildPacMaze, mazeOpens, mazeStep } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeGhost, makePacman, makePellet, makePanel } from "./models3d";
import type { Packet } from "../core/types";

const KEY_WHO = "zoto-viz.pacman.who";
const CELL = 1.15;
const GHOST_COLORS = [0xef5350, 0xff80ab, 0x4fc3f7, 0xffb74d, 0xce93d8];

/** 3D maze: this host is Pac-Man, talkers are ghosts, packets are pellets. */
export class PacmanView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private wall: boolean[][] = buildPacMaze(17, 15);
  private readonly mazeRoot = new THREE.Group();
  private readonly pac: THREE.Group;
  private readonly ghosts = new Map<string, { g: THREE.Group; x: number; y: number; dir: 0 | 1 | 2 | 3 }>();
  private pellets: { mesh: THREE.Mesh; x: number; y: number }[] = [];
  private px = 8;
  private py = 7;
  private pdir: 0 | 1 | 2 | 3 = 0;
  private acc = 0;

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "pacWho", caption: "maze", key: KEY_WHO,
      title: "whose traffic fills the pellets",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 22;
    this.camOrbit.phi = 1.15;
    this.camOrbit.target.set(0, 0.4, 0);
    this.root.add(this.mazeRoot);
    this.pac = makePacman();
    this.root.add(this.pac);
    this.rebuildMaze();
  }

  protected query() {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
    const talkers = this.knownDevices()
      .filter((d) => d.role !== "self" && d.role !== "multicast")
      .sort((a, b) => b.packets - a.packets)
      .slice(0, 5);
    const keep = new Set<string>();
    const opens = mazeOpens(this.wall);
    talkers.forEach((d, i) => {
      keep.add(d.ip);
      if (!this.ghosts.has(d.ip)) {
        const cell = opens[Math.floor((i + 3) * opens.length / 8) % opens.length] ?? [3, 3];
        const g = makeGhost(GHOST_COLORS[i % GHOST_COLORS.length]!);
        this.ghosts.set(d.ip, { g, x: cell[0], y: cell[1], dir: (i % 4) as 0 | 1 | 2 | 3 });
        this.root.add(g);
      }
    });
    for (const [ip, row] of this.ghosts) {
      if (keep.has(ip)) continue;
      row.g.removeFromParent();
      this.ghosts.delete(ip);
    }
  }

  protected ingest(fresh: Packet[]): void {
    const opens = mazeOpens(this.wall);
    for (const p of fresh.slice(-10)) {
      if (this.pellets.length > 80) break;
      const cell = opens[Math.abs(Math.floor(p[0] * 17 + p[5])) % opens.length]!;
      const mesh = makePellet();
      this.place(mesh, cell[0], cell[1], 0);
      this.mazeRoot.add(mesh);
      this.pellets.push({ mesh, x: cell[0], y: cell[1] });
    }
  }

  protected step(now: number, dt: number): void {
    const speed = 3.2 + Math.min(4, this.pps / 30);
    this.acc += dt * speed;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (Math.random() < 0.18) this.pdir = ((this.pdir + (Math.random() < 0.5 ? 1 : 3)) % 4) as 0 | 1 | 2 | 3;
      const next = mazeStep(this.wall, this.px, this.py, this.pdir);
      this.px = next[0]; this.py = next[1]; this.pdir = next[2];
      this.pellets = this.pellets.filter((p) => {
        if (p.x === this.px && p.y === this.py) { p.mesh.removeFromParent(); return false; }
        return true;
      });
      for (const row of this.ghosts.values()) {
        if (Math.random() < 0.28) row.dir = ((row.dir + (Math.random() < 0.5 ? 1 : 3)) % 4) as 0 | 1 | 2 | 3;
        const n = mazeStep(this.wall, row.x, row.y, row.dir);
        row.x = n[0]; row.y = n[1]; row.dir = n[2];
      }
    }
    this.placeWorld(this.pac, this.px, this.py, 0.02);
    this.pac.rotation.y = -this.pdir * Math.PI / 2;
    const mouth = 0.65 + 0.35 * Math.sin(now * 12);
    this.pac.scale.set(1, 1, mouth);
    for (const row of this.ghosts.values()) {
      this.placeWorld(row.g, row.x, row.y, 0);
      row.g.rotation.y = now * 2;
    }
    const [wx, , wz] = this.worldOf(this.px, this.py);
    this.camOrbit.target.lerp(new THREE.Vector3(wx, 0.6, wz), 1 - Math.exp(-dt * 3));
    this.camOrbit.theta += dt * 0.04;
  }

  private rebuildMaze(): void {
    this.mazeRoot.clear();
    const h = this.wall.length, w = this.wall[0]!.length;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w * CELL, h * CELL),
      new THREE.MeshStandardMaterial({ color: 0x0d1b2a, roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.mazeRoot.add(floor);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!this.wall[y]![x]) continue;
        const panel = makePanel(CELL * 0.92, 1.15, CELL * 0.92, 0x1565c0, 0x0d47a1);
        this.place(panel, x, y, 0);
        this.mazeRoot.add(panel);
      }
    }
    const opens = mazeOpens(this.wall);
    this.px = opens[Math.floor(opens.length / 2)]?.[0] ?? 8;
    this.py = opens[Math.floor(opens.length / 2)]?.[1] ?? 7;
    this.mazeRoot.position.set(-(w - 1) * CELL / 2, 0, -(h - 1) * CELL / 2);
  }

  private worldOf(x: number, y: number): [number, number, number] {
    const w = this.wall[0]!.length, h = this.wall.length;
    return [(x - (w - 1) / 2) * CELL, 0, (y - (h - 1) / 2) * CELL];
  }

  private place(obj: THREE.Object3D, x: number, y: number, lift: number): void {
    obj.position.set(x * CELL, lift + 0.55, y * CELL);
  }

  private placeWorld(obj: THREE.Object3D, x: number, y: number, lift: number): void {
    const [wx, , wz] = this.worldOf(x, y);
    obj.position.set(wx, lift + 0.55, wz);
  }

  protected reset(): void {
    super.reset();
    for (const p of this.pellets) p.mesh.removeFromParent();
    this.pellets = [];
  }
}
