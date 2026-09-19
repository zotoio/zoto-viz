import * as THREE from "three";
import type { NetScene } from "../graph/scene";
import { DevicePicker } from "./arcade";
import { TETROMINOES, normalizeCells, rotateCells, tetrominoForProto } from "./stage-math";
import { Stage3D } from "./stage3d";
import { makeTetBlock } from "./models3d";
import type { Packet } from "../core/types";

const KEY_WHO = "zoto-viz.tetris.who";
const COLS = 10;
const ROWS = 16;
const CELL = 0.95;

const PROTO_COLOR: Record<string, number> = {
  tls: 0x42a5f5, dns: 0xffee58, http: 0x66bb6a, quic: 0xab47bc,
  ssh: 0xef5350, udp: 0x26c6da, tcp: 0xffa726, icmp: 0xbdbdbd,
};

interface Piece {
  kind: string;
  cells: [number, number][];
  x: number;
  y: number;
  color: number;
  blocks: THREE.Group[];
  locked?: boolean;
}

/** 3D well: packets become tetrominoes coloured by protocol. Gravity follows packet rate. */
export class TetrisView extends Stage3D {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly well = new THREE.Group();
  private active: Piece | null = null;
  private stack: { x: number; y: number; g: THREE.Group; color: number }[] = [];
  private dropAcc = 0;
  private queue: { kind: string; color: number }[] = [];

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "tetrisWho", caption: "well", key: KEY_WHO,
      title: "whose traffic drops as pieces",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.controls = [this.picker.el];
    this.camOrbit.radius = 24;
    this.camOrbit.phi = 1.18;
    this.camOrbit.theta = Math.PI / 2;
    this.camOrbit.target.set(0, 8, 0);
    this.root.add(this.well);
    this.buildWell();
  }

  protected query() {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
  }

  protected ingest(fresh: Packet[]): void {
    for (const p of fresh.slice(-8)) {
      const proto = (p[3] || "tcp").toLowerCase();
      this.queue.push({
        kind: tetrominoForProto(proto),
        color: PROTO_COLOR[proto] ?? this.colorOf(p[2]),
      });
    }
  }

  protected step(now: number, dt: number): void {
    if (!this.active && this.queue.length) this.spawn(this.queue.shift()!);
    const speed = 1.4 + Math.min(6, this.pps / 18);
    this.dropAcc += dt * speed;
    while (this.dropAcc >= 1 && this.active) {
      this.dropAcc -= 1;
      if (!this.tryMove(0, -1)) this.lock();
    }
    this.camOrbit.theta = Math.PI / 2 + Math.sin(now * 0.18) * 0.18;
  }

  private spawn(next: { kind: string; color: number }): void {
    const cells = normalizeCells(TETROMINOES[next.kind] ?? TETROMINOES.T!);
    const piece: Piece = { kind: next.kind, cells, x: 3, y: ROWS - 2, color: next.color, blocks: [] };
    for (const _c of cells) {
      const g = makeTetBlock(next.color);
      this.well.add(g);
      piece.blocks.push(g);
    }
    this.active = piece;
    this.syncPiece();
    if (this.hits(piece.x, piece.y, piece.cells)) this.clearStack();
  }

  private tryMove(dx: number, dy: number, rot = 0): boolean {
    const p = this.active;
    if (!p) return false;
    const cells = rot ? normalizeCells(rotateCells(p.cells, rot)) : p.cells;
    if (this.hits(p.x + dx, p.y + dy, cells)) return false;
    p.x += dx;
    p.y += dy;
    if (rot) p.cells = cells;
    this.syncPiece();
    return true;
  }

  private lock(): void {
    const p = this.active;
    if (!p) return;
    p.cells.forEach(([cx, cy], i) => {
      this.stack.push({ x: p.x + cx, y: p.y + cy, g: p.blocks[i]!, color: p.color });
    });
    this.active = null;
    this.clearLines();
    if (this.stack.length > COLS * 8) this.clearStack();
  }

  private hits(x: number, y: number, cells: [number, number][]): boolean {
    for (const [cx, cy] of cells) {
      const px = x + cx, py = y + cy;
      if (px < 0 || px >= COLS || py < 0) return true;
      if (this.stack.some((s) => s.x === px && s.y === py)) return true;
    }
    return false;
  }

  private clearLines(): void {
    for (let y = 0; y < ROWS; y++) {
      const row = this.stack.filter((s) => s.y === y);
      if (row.length < COLS) continue;
      for (const s of row) s.g.removeFromParent();
      this.stack = this.stack.filter((s) => s.y !== y);
      for (const s of this.stack) {
        if (s.y > y) { s.y -= 1; this.place(s.g, s.x, s.y); }
      }
    }
  }

  private clearStack(): void {
    for (const s of this.stack) s.g.removeFromParent();
    this.stack = [];
    if (this.active) {
      for (const g of this.active.blocks) g.removeFromParent();
      this.active = null;
    }
  }

  private syncPiece(): void {
    const p = this.active;
    if (!p) return;
    p.cells.forEach(([cx, cy], i) => this.place(p.blocks[i]!, p.x + cx, p.y + cy));
  }

  private place(g: THREE.Object3D, x: number, y: number): void {
    g.position.set((x - (COLS - 1) / 2) * CELL, y * CELL + 0.45, 0);
  }

  private buildWell(): void {
    const wall = new THREE.MeshStandardMaterial({ color: 0x546e7a, metalness: 0.2, roughness: 0.4 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xb3e5fc, transparent: true, opacity: 0.12, roughness: 0.08, metalness: 0.08, side: THREE.DoubleSide,
    });
    const fill = new THREE.PointLight(0xc8ff9e, 1.4, 40);
    fill.position.set(0, 10, 8);
    this.well.add(fill);
    const w = COLS * CELL, h = ROWS * CELL;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.4, h + 0.4), glass);
    back.position.set(0, h / 2, -0.55);
    this.well.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.25, h + 0.4, 1.2), wall);
    left.position.set(-w / 2 - 0.2, h / 2, 0);
    const right = left.clone();
    right.position.x = w / 2 + 0.2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.3, 1.2), wall);
    floor.position.set(0, -0.15, 0);
    this.well.add(left, right, floor);
  }

  protected reset(): void {
    super.reset();
    this.clearStack();
    this.queue = [];
    this.dropAcc = 0;
  }
}
