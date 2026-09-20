import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { sourceHeadlines } from "../core/sources";
import { DevicePicker } from "./arcade";
import { buildPacMaze, mazeOpens, mazeStep } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeGhost, makePacman, makePellet, makePanel } from "./models3d";
import { bitePhrases, facingOf, launchCrumbs, mouthCameraTheta, stepCrumb, tickerApproach, type Crumb } from "./pacman-ticker";
import type { Packet } from "../core/types";

const KEY_WHO = "zoto-viz.pacman.who";
const CELL = 1.15;
const GHOST_COLORS = [0xef5350, 0xff80ab, 0x4fc3f7, 0xffb74d, 0xce93d8];

type Bite = { mesh: THREE.Mesh; from: [number, number, number]; t: number; text: string };

/** 3D maze: this host is Pac-Man. Ticker words fly into the mouth; crumbs hop out and fall. */
export class PacmanView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private wall: boolean[][] = buildPacMaze(17, 15);
  private readonly mazeRoot = new THREE.Group();
  private readonly pac: THREE.Group;
  private readonly ghosts = new Map<string, { g: THREE.Group; x: number; y: number; dir: 0 | 1 | 2 | 3 }>();
  private pellets: { mesh: THREE.Mesh; x: number; y: number }[] = [];
  private bites: Bite[] = [];
  private crumbs: { mesh: THREE.Mesh; c: Crumb }[] = [];
  private playlist: string[] = ["live ticker", "LAN pulse", "packet crumb"];
  private playAt = 0;
  private chew = 0;
  private spawnWait = 0;
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
    this.camOrbit.radius = 13.5;
    this.camOrbit.phi = 1.28;
    this.camOrbit.theta = 0;
    this.camOrbit.target.set(0, 0.85, 0);
    this.root.add(this.mazeRoot);
    this.pac = makePacman();
    this.root.add(this.pac);
    this.rebuildMaze();
  }

  setTicker(lines: string[]): void {
    const next = bitePhrases(lines, 22);
    if (next.length) this.playlist = next;
  }

  protected query() {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
    this.setTicker(sourceHeadlines(this.msg.sources).map((h) => `${h.label} ${h.text}`));
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
    this.stepTicker(dt);
    const chomp = this.chew > 0 ? 0.22 + 0.78 * Math.abs(Math.sin(now * 22)) : 0.65 + 0.35 * Math.sin(now * 12);
    this.pac.scale.set(1, 1, chomp);
    this.chew = Math.max(0, this.chew - dt);
    for (const row of this.ghosts.values()) {
      this.placeWorld(row.g, row.x, row.y, 0);
      row.g.rotation.y = now * 2;
    }
    const [wx, , wz] = this.worldOf(this.px, this.py);
    this.camOrbit.target.lerp(new THREE.Vector3(wx, 0.85, wz), 1 - Math.exp(-dt * 3.2));
    const want = mouthCameraTheta(this.pdir);
    let dth = want - this.camOrbit.theta;
    while (dth > Math.PI) dth -= Math.PI * 2;
    while (dth < -Math.PI) dth += Math.PI * 2;
    this.camOrbit.theta += dth * (1 - Math.exp(-dt * 2.4));
    this.camOrbit.phi += (1.28 - this.camOrbit.phi) * (1 - Math.exp(-dt * 2));
    this.camOrbit.radius += (13.5 - this.camOrbit.radius) * (1 - Math.exp(-dt * 1.6));
  }

  private stepTicker(dt: number): void {
    const [wx, , wz] = this.worldOf(this.px, this.py);
    const [fx, fz] = facingOf(this.pdir);
    const mouth: [number, number, number] = [wx + fx * 0.62, 0.92, wz + fz * 0.62];
    this.spawnWait -= dt;
    if (this.spawnWait <= 0 && this.bites.length < 5 && this.playlist.length) {
      const text = this.playlist[this.playAt++ % this.playlist.length]!;
      const from: [number, number, number] = [wx + fx * 7.4, 2.55, wz + fz * 7.4];
      const mesh = makeBiteCard(text);
      this.root.add(mesh);
      this.bites.push({ mesh, from, t: 0, text });
      this.spawnWait = 0.52;
    }
    const keep: Bite[] = [];
    for (const bite of this.bites) {
      bite.t += dt * 0.55;
      if (bite.t >= 1) {
        bite.mesh.removeFromParent();
        (bite.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
        this.chew = 0.42;
        this.burstCrumbs(mouth, bite.text.length);
        continue;
      }
      const [x, y, z] = tickerApproach(bite.from, mouth, bite.t);
      bite.mesh.position.set(x, y, z);
      bite.mesh.lookAt(this.camera.position);
      const s = 1 - bite.t * 0.45;
      bite.mesh.scale.setScalar(s);
      keep.push(bite);
    }
    this.bites = keep;
    const live: { mesh: THREE.Mesh; c: Crumb }[] = [];
    for (const row of this.crumbs) {
      const next = stepCrumb(row.c, dt, 0.08);
      if (!next) {
        row.mesh.removeFromParent();
        continue;
      }
      row.c = next;
      row.mesh.position.set(next.x, next.y, next.z);
      live.push(row);
    }
    this.crumbs = live;
  }

  private burstCrumbs(origin: [number, number, number], n: number): void {
    for (const c of launchCrumbs(origin, 8 + (n % 5), this.crumbs.length)) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.14, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xffee58 }),
      );
      mesh.position.set(c.x, c.y, c.z);
      this.root.add(mesh);
      this.crumbs.push({ mesh, c });
    }
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
    for (const b of this.bites) b.mesh.removeFromParent();
    this.bites = [];
    for (const c of this.crumbs) c.mesh.removeFromParent();
    this.crumbs = [];
  }
}

function makeBiteCard(text: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 640, 128);
    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fillRect(0, 18, 640, 92);
    ctx.strokeStyle = "#ffee58";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 22, 632, 84);
    ctx.fillStyle = "#ffee58";
    ctx.font = "800 52px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 18), 22, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 0.84),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
}
